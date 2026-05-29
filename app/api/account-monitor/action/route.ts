import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/account-monitor/action
// Body: {
//   sender_email: string,
//   workspace_slug: string,
//   action: "remove" | "reattach" | "remove_and_warmup" | "attach_to_all",
//   campaign_id?: number,   // remove/reattach: act only on this campaign
//   sender_id?: number,     // skip the EB lookup if caller resolved it
// }
//
// attach_to_all fetches all active (non-paused, non-completed) campaigns in
// the workspace from EB and attaches the sender to every one. Used by the
// Warmup Monitor's "Add to all campaigns" action after a sender finishes
// warmup and is ready to rejoin.
//
// remove_and_warmup sets sender_accounts.warming_since = NOW() so the
// dashboard can show "Warming for X days" and surface ready-to-rejoin
// senders. reattach (and attach_to_all) clears warming_since.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sender_email, workspace_slug, action, campaign_id, sender_id: providedSenderId } = body;

    if (!sender_email || !workspace_slug || !action) {
      return NextResponse.json(
        { error: "sender_email, workspace_slug, and action are required" },
        { status: 400 }
      );
    }

    if (!["remove", "reattach", "remove_and_warmup", "attach_to_all", "enable_warmup"].includes(action)) {
      return NextResponse.json(
        { error: "action must be one of: remove, reattach, remove_and_warmup, attach_to_all, enable_warmup" },
        { status: 400 }
      );
    }

    // 1. Get workspace EB credentials
    const wsResult = await pool.query(
      "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
      [workspace_slug]
    );
    if (wsResult.rows.length === 0) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const { email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = wsResult.rows[0];
    if (!apiKey || !instanceUrl) {
      return NextResponse.json({ error: "Workspace missing EmailBison credentials" }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

   // 2. Resolve sender ID — check sender_accounts DB first (avoids EB search pagination issues),
    //    fall back to EB search only if not found in DB.
    let senderId: number = providedSenderId;
    let warmupAlreadyEnabled = false;

    if (!senderId) {
      // Try DB first — eb_sender_id is stored during sync
      const dbSender = await pool.query(
        `SELECT eb_sender_id, warmup_enabled FROM sender_accounts
         WHERE workspace_slug = $1 AND email = $2 LIMIT 1`,
        [workspace_slug, sender_email.toLowerCase()]
      );

      if (dbSender.rows.length > 0 && dbSender.rows[0].eb_sender_id) {
        senderId = dbSender.rows[0].eb_sender_id;
        warmupAlreadyEnabled = dbSender.rows[0].warmup_enabled ?? false;
      } else {
        // Fall back to EB search
        const searchRes = await fetch(
          `${instanceUrl}/api/sender-emails?search=${encodeURIComponent(sender_email)}`,
          { headers }
        );
        if (!searchRes.ok) {
          const err = await searchRes.text();
          return NextResponse.json(
            { error: `EmailBison sender lookup failed (${searchRes.status}): ${err}` },
            { status: 502 }
          );
        }
        const searchData = await searchRes.json();
        const sender = (searchData.data ?? []).find(
          (s: any) => s.email?.toLowerCase() === sender_email.toLowerCase()
        );
        if (!sender) {
          return NextResponse.json(
            { error: `Sender '${sender_email}' not found in EmailBison` },
            { status: 404 }
          );
        }
        senderId = sender.id;
        warmupAlreadyEnabled = sender.warmup_enabled ?? false;
      }
    }

    // 3. Build the list of campaigns to act on. status is filled in only
    //    for the remove-style actions, where we need it to gate auto-pause.
    let campaigns: { id: number; name: string; status?: string }[] = [];

    if (action === "enable_warmup") {
      // No campaign work — just flip the warmup switch and return.
      campaigns = [];
    } else if (campaign_id) {
      // Single campaign — caller provided it, no need to fetch all
      campaigns = [{ id: campaign_id, name: "" }];
    } else if (action === "attach_to_all") {
      // All currently-running campaigns in the workspace (active outbound,
      // not paused/completed/archived). The sender will be attached to each.
      const campsRes = await fetch(
        `${instanceUrl}/api/campaigns?per_page=250`,
        { headers }
      );
      if (!campsRes.ok) {
        const err = await campsRes.text();
        return NextResponse.json(
          { error: `Failed to fetch workspace campaigns (${campsRes.status}): ${err}` },
          { status: 502 }
        );
      }
      const campsData = await campsRes.json();
      campaigns = (campsData.data ?? [])
        .filter((c: any) => {
          const s = String(c.status ?? "").toLowerCase();
          // Include all non-terminal states. EB campaigns cycle through
          //   draft -> queued -> launching -> active (live/running)
          // plus paused (manually paused). We attach to anything that
          // is currently sending or about to send. Completed/archived
          // are excluded.
          return s === "active" || s === "running" || s === "live"
              || s === "draft"  || s === "queued"  || s === "launching"
              || s === "paused";
        })
        .map((c: any) => ({ id: c.id, name: c.name }));
    } else {
      // remove / remove_and_warmup / reattach — operate on campaigns this
      // sender is currently attached to. We also need each campaign's
      // status because EB rejects DELETE on active campaigns
      // ("The campaign must be in a draft or paused state to remove sender
      // emails"). Active campaigns get an auto-pause / remove / resume
      // round trip in step 4 below.
      const campsRes = await fetch(
        `${instanceUrl}/api/sender-emails/${senderId}/campaigns`,
        { headers }
      );
      if (!campsRes.ok) {
        const err = await campsRes.text();
        return NextResponse.json(
          { error: `Failed to fetch sender campaigns (${campsRes.status}): ${err}` },
          { status: 502 }
        );
      }
      const campsData = await campsRes.json();
      // Completed and archived campaigns can't be DELETE'd (EB rejects with
      // "campaign must be draft or paused") and they aren't actively sending
      // anyway, so removing the sender from them is meaningless. Skip them.
      const TERMINAL = new Set(["completed", "archived", "finished", "ended"]);
      campaigns = (campsData.data ?? [])
        .map((c: any) => ({
          id: c.id, name: c.name, status: String(c.status ?? "").toLowerCase(),
        }))
        .filter((c: any) => !TERMINAL.has(c.status));
    }

    type ActionResult = { campaign_id: number; campaign_name: string; status: string; error?: string };
    const results: ActionResult[] = [];

    // Helper: pause / resume a campaign. Both endpoints are PATCH. Pause
    // returns the campaign with status='paused'; resume goes to 'queued'
    // and resumes sending on EB's own timer.
    const setCampaignStatus = async (id: number, op: "pause" | "resume") => {
      return fetch(`${instanceUrl}/api/campaigns/${id}/${op}`, {
        method: "PATCH", headers, body: "{}",
      });
    };

    // 4. Remove or attach. EB's DELETE is async ("Sender emails sent for
    //    deletion. This may take a moment.") and completes within a few
    //    seconds. EB rejects DELETE on active campaigns, so we pause those
    //    first. The deletion job EB queues will be cancelled if the
    //    campaign is touched (e.g. resumed) before it completes — and
    //    issuing other DELETE calls on the same workspace seems to clobber
    //    pending jobs too. So we structure the work as:
    //      a) pause all active campaigns in parallel
    //      b) DELETE on every campaign in parallel
    //      c) wait ONCE (8s) for EB to drain the deletion queue
    //      d) resume those we paused in parallel
    //    Sequential-per-campaign waits added up to nearly 2 minutes for
    //    senders attached to many campaigns and produced unreliable
    //    results because intermediate DELETEs cancelled earlier jobs.
    // EB only allows DELETE on "draft" or "paused". Everything else
    // (active, running, live, launching, queued, …) needs to be paused
    // first. We use a deny-list against the two known-pausable states
    // rather than an allow-list of active states, because EB has shipped
    // new statuses ("launching", "queued") that we kept missing and that
    // silently broke the auto-pause step for whole batches of senders.
    const PAUSABLE_STATES = new Set(["draft", "paused"]);
    const REMOVE_WAIT_MS = 8000;

    if (action === "remove" || action === "remove_and_warmup") {
      // Step a: pause anything that isn't already pause-eligible
      const pausedCamps: number[] = [];
      const pausePromises = campaigns
        .filter(c => !PAUSABLE_STATES.has(c.status ?? ""))
        .map(async c => {
          const r = await setCampaignStatus(c.id, "pause");
          if (r.ok) pausedCamps.push(c.id);
          else {
            const err = await r.text();
            results.push({ campaign_id: c.id, campaign_name: c.name, status: "error", error: `pause failed: ${err}` });
          }
        });
      await Promise.all(pausePromises);

      // Step b: DELETE in parallel for all campaigns whose pause did not fail
      const failedIds = new Set(results.filter(r => r.status === "error").map(r => r.campaign_id));
      const removable = campaigns.filter(c => !failedIds.has(c.id));
      const removeResults = await Promise.all(removable.map(async c => {
        const r = await fetch(
          `${instanceUrl}/api/campaigns/${c.id}/remove-sender-emails`,
          { method: "DELETE", headers, body: JSON.stringify({ sender_email_ids: [senderId] }) }
        );
        return { camp: c, ok: r.ok, err: r.ok ? null : await r.text() };
      }));

      // Step c: single wait for EB to drain the async deletion queue.
      // EB completes deletions in ~5s; 8s gives margin.
      if (removeResults.some(r => r.ok)) {
        await new Promise(r => setTimeout(r, REMOVE_WAIT_MS));
      }

      // Step d: resume paused campaigns in parallel
      const resumeMap: Record<number, boolean> = {};
      await Promise.all(pausedCamps.map(async id => {
        const r = await setCampaignStatus(id, "resume");
        resumeMap[id] = r.ok;
        if (!r.ok) {
          // Will be reported below alongside the campaign result
          console.error(`[account-monitor/action] resume failed for campaign ${id}`);
        }
      }));

      // Stitch results
      for (const { camp, ok, err } of removeResults) {
        const wasPaused = pausedCamps.includes(camp.id);
        const resumeOk = !wasPaused || resumeMap[camp.id];
        if (ok && resumeOk) {
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "removed" });
        } else if (ok && !resumeOk) {
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "removed_but_resume_failed", error: "campaign left paused — resume manually" });
        } else {
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "error", error: err ?? "remove failed" });
        }
      }
    } else if (action === "reattach" || action === "attach_to_all") {
      // Attaches in parallel for speed. Attach is synchronous on EB's side.
      await Promise.all(campaigns.map(async camp => {
        const attachRes = await fetch(
          `${instanceUrl}/api/campaigns/${camp.id}/attach-sender-emails`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ sender_email_ids: [senderId] }),
          }
        );
        if (attachRes.ok) {
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "attached" });
        } else {
          const err = await attachRes.text();
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "error", error: err });
        }
      }));
    }

    // 5. Enable warmup if requested. For enable_warmup we always hit EB
    //    regardless of the cached warmup_enabled value — the local DB can be
    //    stale (warmup gets toggled in EB UI between syncs) and the operator
    //    is explicitly asking for the on-state, so we should respect that.
    //    For remove_and_warmup we keep the cached short-circuit since the
    //    primary intent is the remove, not the warmup flip.
    let warmupResult: string | null = null;
    const shouldEnable =
      action === "enable_warmup" ||
      (action === "remove_and_warmup" && !warmupAlreadyEnabled);
    if (shouldEnable) {
      const warmupRes = await fetch(`${instanceUrl}/api/warmup/sender-emails/enable`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sender_email_ids: [senderId] }),
      });
      warmupResult = warmupRes.ok ? "enabled" : `failed (${warmupRes.status})`;
      // Mirror the new state into our local DB so the dashboard reflects
      // it without waiting for the next sync.
      if (warmupRes.ok) {
        await pool.query(
          `UPDATE sender_accounts SET warmup_enabled = TRUE
           WHERE workspace_slug = $1 AND email = $2`,
          [workspace_slug, sender_email.toLowerCase()]
        );
      }
    } else if (action === "remove_and_warmup" && warmupAlreadyEnabled) {
      warmupResult = "already_enabled";
    }

    // 6. Warming-since lifecycle. remove_and_warmup starts the clock;
    //    reattach / attach_to_all clears it (sender is back in production).
    //    "remove" alone does NOT touch warming_since because the sender
    //    might be getting yanked for other reasons (burned, list issue).
    if (action === "remove_and_warmup") {
      await pool.query(
        `UPDATE sender_accounts SET warming_since = NOW()
         WHERE workspace_slug = $1 AND email = $2`,
        [workspace_slug, sender_email.toLowerCase()]
      );
    } else if (action === "reattach" || action === "attach_to_all") {
      await pool.query(
        `UPDATE sender_accounts SET warming_since = NULL
         WHERE workspace_slug = $1 AND email = $2 AND warming_since IS NOT NULL`,
        [workspace_slug, sender_email.toLowerCase()]
      );
    }

    // 7. Refresh the sender's attached_campaigns_count from EB so the
    //    Warmup Monitor and Domain Monitor reflect the action immediately
    //    instead of waiting for the next sync. Without this, after a
    //    Pause-outbound the dashboard still shows "In 1 campaign" until
    //    the periodic sync runs. Failures here are non-fatal — the next
    //    sync will catch up. Only refresh for campaign-affecting actions.
    if (action !== "enable_warmup") {
      try {
        const refreshRes = await fetch(
          `${instanceUrl}/api/sender-emails/${senderId}/campaigns`,
          { headers }
        );
        if (refreshRes.ok) {
          const body = await refreshRes.json();
          // Match the action-side filter: completed/archived campaigns are
          // not actively sending and should not count as "attached" for
          // dashboard purposes (otherwise the row keeps showing
          // "In 1 campaign" after Pause+warmup against a completed one).
          const TERMINAL = new Set(["completed", "archived", "finished", "ended"]);
          const liveCount = (body?.data ?? []).filter((c: any) =>
            !TERMINAL.has(String(c.status ?? "").toLowerCase())
          ).length;
          await pool.query(
            `UPDATE sender_accounts SET attached_campaigns_count = $1
             WHERE workspace_slug = $2 AND email = $3`,
            [liveCount, workspace_slug, sender_email.toLowerCase()]
          );
        }
      } catch (err: any) {
        console.error("[account-monitor/action] attached-count refresh failed:", err?.message);
      }
    }

    const succeeded = results.filter(r => r.status !== "error").length;
    const failed    = results.filter(r => r.status === "error").length;

    return NextResponse.json({
      ok: true,
      sender_email,
      sender_id: senderId,
      action,
      campaigns_affected: campaigns.length,
      succeeded,
      failed,
      results,
      warmup: warmupResult,
    });

  } catch (err: any) {
    console.error("[account-monitor/action] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
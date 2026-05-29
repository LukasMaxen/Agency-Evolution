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
      campaigns = (campsData.data ?? []).map((c: any) => ({
        id: c.id, name: c.name, status: String(c.status ?? "").toLowerCase(),
      }));
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
    //    seconds. EB rejects DELETE on active campaigns, so we pause first
    //    and resume after.
    const ACTIVE_STATES = new Set(["active", "running", "live"]);
    // EB's DELETE on a paused campaign is async ("Sender emails sent for
    // deletion. This may take a moment.") and completes in ~5s. If we
    // PATCH /resume too early, EB cancels the queued deletion and the
    // sender stays attached. 8s is the smallest wait observed to be
    // reliable in live testing.
    const REMOVE_WAIT_MS = 8000;

    for (const camp of campaigns) {
      if (action === "remove" || action === "remove_and_warmup") {
        const wasActive = ACTIVE_STATES.has(camp.status ?? "");
        let pausedByUs = false;

        if (wasActive) {
          const pauseRes = await setCampaignStatus(camp.id, "pause");
          if (!pauseRes.ok) {
            const err = await pauseRes.text();
            results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "error", error: `pause failed: ${err}` });
            continue;
          }
          pausedByUs = true;
        }

        const removeRes = await fetch(
          `${instanceUrl}/api/campaigns/${camp.id}/remove-sender-emails`,
          {
            method: "DELETE",
            headers,
            body: JSON.stringify({ sender_email_ids: [senderId] }),
          }
        );
        const removeOk = removeRes.ok;
        const removeErr = removeOk ? null : await removeRes.text();

        if (pausedByUs) {
          // EB DELETE is async. Give it a beat before resuming so the
          // detach completes before sends fire again.
          if (removeOk) await new Promise(r => setTimeout(r, REMOVE_WAIT_MS));
          const resumeRes = await setCampaignStatus(camp.id, "resume");
          if (!resumeRes.ok) {
            // Resume failed — log loudly. Campaign will remain paused in
            // EB until the user resumes it manually.
            const err = await resumeRes.text();
            results.push({
              campaign_id: camp.id, campaign_name: camp.name,
              status: removeOk ? "removed_but_resume_failed" : "error",
              error: removeOk ? `RESUME FAILED — campaign left paused: ${err}` : `${removeErr}; resume also failed: ${err}`,
            });
            continue;
          }
        }

        if (removeOk) {
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "removed" });
        } else {
          results.push({ campaign_id: camp.id, campaign_name: camp.name, status: "error", error: removeErr ?? "remove failed" });
        }
      } else if (action === "reattach" || action === "attach_to_all") {
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
      }
    }

    // 5. Enable warmup if requested
    let warmupResult: string | null = null;
    if ((action === "remove_and_warmup" || action === "enable_warmup") && !warmupAlreadyEnabled) {
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
    } else if ((action === "remove_and_warmup" || action === "enable_warmup") && warmupAlreadyEnabled) {
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
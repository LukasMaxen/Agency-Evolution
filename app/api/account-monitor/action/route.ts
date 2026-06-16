import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/account-monitor/action
// Body: {
//   sender_email: string,
//   workspace_slug: string,
//   action: "pause_outbound_and_warmup" | "attach_to_all" | "enable_warmup",
//   sender_id?: number,
// }
//
// IMPORTANT: this route MUST NEVER call /api/campaigns/{id}/remove-sender-emails
// or any other endpoint that unattaches senders from campaigns. EB keeps the
// lead-sender pairing for follow-up steps; if a sender is unattached while
// leads are mid-sequence, those leads' follow-ups stop firing entirely.
// Operator lost prospects to this in May/June 2026; pause_outbound_and_warmup
// throttles daily_limit to 1 instead, which keeps follow-ups alive while
// effectively stopping new sends. See feedback memory:
//   feedback-never-remove-sender-from-campaign.md
//
// Actions:
//   pause_outbound_and_warmup
//     PATCH sender's daily_limit -> 1, enable warmup, stamp warming_since.
//     Sender stays attached to every campaign so follow-ups keep firing.
//   attach_to_all
//     Attach the sender to every active campaign in the workspace and
//     clear warming_since.
//   enable_warmup
//     Just flip the warmup switch on.

const PAUSE_DAILY_LIMIT = 1;
const TERMINAL_STATES = new Set(["completed", "archived", "finished", "ended"]);
const ATTACH_STATES = new Set(["active", "running", "live", "draft", "queued", "launching", "paused"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sender_email, workspace_slug, action, sender_id: providedSenderId } = body;

    if (!sender_email || !workspace_slug || !action) {
      return NextResponse.json(
        { error: "sender_email, workspace_slug, and action are required" },
        { status: 400 }
      );
    }

    if (!["pause_outbound_and_warmup", "attach_to_all", "enable_warmup"].includes(action)) {
      return NextResponse.json(
        { error: "action must be one of: pause_outbound_and_warmup, attach_to_all, enable_warmup" },
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

    // 2. Resolve sender ID — check sender_accounts DB first (avoids EB search
    //    pagination issues), fall back to EB search only if not found in DB.
    let senderId: number = providedSenderId;
    let warmupAlreadyEnabled = false;

    if (!senderId) {
      const dbSender = await pool.query(
        `SELECT eb_sender_id, warmup_enabled FROM sender_accounts
         WHERE workspace_slug = $1 AND email = $2 LIMIT 1`,
        [workspace_slug, sender_email.toLowerCase()]
      );

      if (dbSender.rows.length > 0 && dbSender.rows[0].eb_sender_id) {
        senderId = dbSender.rows[0].eb_sender_id;
        warmupAlreadyEnabled = dbSender.rows[0].warmup_enabled ?? false;
      } else {
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

    // ── pause_outbound_and_warmup ────────────────────────────────────────
    if (action === "pause_outbound_and_warmup") {
      const throttleRes = await fetch(`${instanceUrl}/api/sender-emails/${senderId}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ daily_limit: PAUSE_DAILY_LIMIT }),
      });
      const throttleOk = throttleRes.ok;
      const throttleErr = throttleOk ? null : await throttleRes.text();

      let warmupResult: string;
      if (warmupAlreadyEnabled) {
        warmupResult = "already_enabled";
      } else {
        const warmupRes = await fetch(`${instanceUrl}/api/warmup/sender-emails/enable`, {
          method: "PATCH", headers,
          body: JSON.stringify({ sender_email_ids: [senderId] }),
        });
        warmupResult = warmupRes.ok ? "enabled" : `failed (${warmupRes.status})`;
        if (warmupRes.ok) {
          await pool.query(
            `UPDATE sender_accounts SET warmup_enabled = TRUE
             WHERE workspace_slug = $1 AND email = $2`,
            [workspace_slug, sender_email.toLowerCase()]
          );
        }
      }

      await pool.query(
        `UPDATE sender_accounts SET warming_since = NOW()
         WHERE workspace_slug = $1 AND email = $2`,
        [workspace_slug, sender_email.toLowerCase()]
      );

      return NextResponse.json({
        ok:              throttleOk,
        sender_email,
        sender_id:       senderId,
        action,
        daily_limit_set: PAUSE_DAILY_LIMIT,
        throttle_error:  throttleErr,
        warmup:          warmupResult,
      });
    }

    // ── enable_warmup ────────────────────────────────────────────────────
    if (action === "enable_warmup") {
      const warmupRes = await fetch(`${instanceUrl}/api/warmup/sender-emails/enable`, {
        method: "PATCH", headers,
        body: JSON.stringify({ sender_email_ids: [senderId] }),
      });
      const ok = warmupRes.ok;
      if (ok) {
        await pool.query(
          `UPDATE sender_accounts SET warmup_enabled = TRUE
           WHERE workspace_slug = $1 AND email = $2`,
          [workspace_slug, sender_email.toLowerCase()]
        );
      }
      return NextResponse.json({
        ok,
        sender_email,
        sender_id: senderId,
        action,
        warmup:    ok ? "enabled" : `failed (${warmupRes.status})`,
      });
    }

    // ── attach_to_all ────────────────────────────────────────────────────
    const campsRes = await fetch(`${instanceUrl}/api/campaigns?per_page=250`, { headers });
    if (!campsRes.ok) {
      const err = await campsRes.text();
      return NextResponse.json(
        { error: `Failed to fetch workspace campaigns (${campsRes.status}): ${err}` },
        { status: 502 }
      );
    }
    const campsData = await campsRes.json();
    const campaigns = (campsData.data ?? [])
      .filter((c: any) => ATTACH_STATES.has(String(c.status ?? "").toLowerCase()))
      .map((c: any) => ({ id: c.id, name: c.name }));

    type AttachResult = { campaign_id: number; campaign_name: string; status: string; error?: string };
    const results: AttachResult[] = [];

    await Promise.all(campaigns.map(async (camp: { id: number; name: string }) => {
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

    await pool.query(
      `UPDATE sender_accounts SET warming_since = NULL
       WHERE workspace_slug = $1 AND email = $2 AND warming_since IS NOT NULL`,
      [workspace_slug, sender_email.toLowerCase()]
    );

    // Refresh attached_campaigns_count so the dashboard reflects the attach
    // immediately.
    try {
      const refreshRes = await fetch(
        `${instanceUrl}/api/sender-emails/${senderId}/campaigns`,
        { headers }
      );
      if (refreshRes.ok) {
        const refreshBody = await refreshRes.json();
        const liveCount = (refreshBody?.data ?? []).filter((c: any) =>
          !TERMINAL_STATES.has(String(c.status ?? "").toLowerCase())
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

    const succeeded = results.filter(r => r.status !== "error").length;
    const failed    = results.filter(r => r.status === "error").length;

    return NextResponse.json({
      ok: failed === 0,
      sender_email,
      sender_id: senderId,
      action,
      campaigns_affected: campaigns.length,
      succeeded,
      failed,
      results,
    });

  } catch (err: any) {
    console.error("[account-monitor/action] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/warmup-monitor/sync-campaigns
//
// One-click "ensure every active sender is in every active campaign" sweep.
//
// For each workspace:
//   1) pull the list of active outbound campaigns from EmailBison
//   2) pull the list of connected, warmup-enabled senders that are already
//      attached to at least one campaign (i.e. "active" in dashboard terms)
//   3) for each campaign, fetch its current attached sender list and
//      attach the active senders that are missing
//
// Warming-only senders (attached_campaigns_count = 0) are intentionally
// skipped: they are being warmed up and the operator pulls them back
// manually via "Add to campaigns" once ready. Disconnected senders are
// skipped because EB will accept the attach but it has no effect until
// the mailbox is reconnected.
//
// The attach endpoint is set-additive on EB's side, but we still diff
// against the current attached list so the response includes a meaningful
// "newly attached" count instead of false-claiming work that was already
// in place.

const ACTIVE_CAMPAIGN_STATES = new Set([
  "active", "running", "live", "launching", "queued", "draft", "paused",
]);

export async function POST() {
  try {
    const wsRes = await pool.query(
      `SELECT slug, email_bison_api_key, email_bison_instance_url FROM workspaces
        WHERE email_bison_api_key IS NOT NULL AND email_bison_instance_url IS NOT NULL`
    );

    type WsReport = {
      workspace_slug: string;
      campaigns:      number;
      active_senders: number;
      attached:       number;
      already:        number;
      errors:         { campaign_id: number; campaign_name: string; error: string }[];
    };
    const report: WsReport[] = [];
    let totalAttached = 0;

    for (const ws of wsRes.rows) {
      const { slug, email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = ws;
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      const wsReport: WsReport = {
        workspace_slug: slug, campaigns: 0, active_senders: 0, attached: 0, already: 0, errors: [],
      };

      // Active senders in this workspace, by eb_sender_id. Filter to the
      // ones we actually want in outbound: connected, warmup enabled,
      // already attached to >= 1 campaign. Warming-only and disconnected
      // are excluded.
      const sendersRes = await pool.query(
        `SELECT eb_sender_id FROM sender_accounts
          WHERE workspace_slug = $1
            AND eb_sender_id IS NOT NULL
            AND status = 'Connected'
            AND warmup_enabled = TRUE
            AND COALESCE(attached_campaigns_count, 0) > 0`,
        [slug]
      );
      const senderIds: number[] = sendersRes.rows.map(r => Number(r.eb_sender_id)).filter(n => Number.isFinite(n));
      wsReport.active_senders = senderIds.length;
      if (senderIds.length === 0) {
        report.push(wsReport);
        continue;
      }
      const senderIdSet = new Set(senderIds);

      // Active campaigns to sync into. Skip completed/archived.
      const campsRes = await fetch(`${instanceUrl}/api/campaigns?per_page=250`, { headers });
      if (!campsRes.ok) {
        wsReport.errors.push({ campaign_id: 0, campaign_name: "<list-campaigns>", error: `list failed: ${campsRes.status}` });
        report.push(wsReport);
        continue;
      }
      const campsJson = await campsRes.json();
      const campaigns: { id: number; name: string }[] = (campsJson.data ?? [])
        .filter((c: any) => ACTIVE_CAMPAIGN_STATES.has(String(c.status ?? "").toLowerCase()))
        .map((c: any) => ({ id: c.id, name: c.name }));
      wsReport.campaigns = campaigns.length;

      // Per campaign: diff current attached senders against the target
      // active-sender set and attach the missing ones in a single POST.
      for (const camp of campaigns) {
        try {
          const attachedRes = await fetch(`${instanceUrl}/api/campaigns/${camp.id}/sender-emails?per_page=250`, { headers });
          if (!attachedRes.ok) {
            wsReport.errors.push({ campaign_id: camp.id, campaign_name: camp.name, error: `list senders failed: ${attachedRes.status}` });
            continue;
          }
          const attachedJson = await attachedRes.json();
          const attachedIds = new Set<number>(
            (attachedJson.data ?? []).map((s: any) => Number(s.id)).filter((n: number) => Number.isFinite(n))
          );
          const missing = senderIds.filter(id => !attachedIds.has(id));
          const alreadyHere = senderIds.filter(id => attachedIds.has(id)).length;
          wsReport.already += alreadyHere;
          if (missing.length === 0) continue;

          const attachRes = await fetch(`${instanceUrl}/api/campaigns/${camp.id}/attach-sender-emails`, {
            method: "POST", headers,
            body: JSON.stringify({ sender_email_ids: missing }),
          });
          if (!attachRes.ok) {
            const err = await attachRes.text();
            wsReport.errors.push({ campaign_id: camp.id, campaign_name: camp.name, error: `attach failed: ${err.slice(0, 200)}` });
            continue;
          }
          wsReport.attached += missing.length;
          totalAttached += missing.length;
        } catch (err: any) {
          wsReport.errors.push({ campaign_id: camp.id, campaign_name: camp.name, error: err?.message ?? "unknown" });
        }
      }

      // Refresh attached_campaigns_count for every sender we touched so
      // the dashboard reflects the new attachments immediately. Pull the
      // live list per sender; the next periodic sync would catch up on
      // its own but the operator just clicked a button and expects to
      // see the change now.
      await Promise.all(senderIds.map(async id => {
        try {
          const r = await fetch(`${instanceUrl}/api/sender-emails/${id}/campaigns`, { headers });
          if (!r.ok) return;
          const body = await r.json();
          const TERMINAL = new Set(["completed", "archived", "finished", "ended"]);
          const liveCount = (body?.data ?? []).filter((c: any) => !TERMINAL.has(String(c.status ?? "").toLowerCase())).length;
          await pool.query(
            `UPDATE sender_accounts SET attached_campaigns_count = $1
              WHERE workspace_slug = $2 AND eb_sender_id = $3`,
            [liveCount, slug, id]
          );
        } catch { /* non-fatal */ }
      }));

      report.push(wsReport);
    }

    return NextResponse.json({
      ok: true,
      total_attached: totalAttached,
      workspaces:     report,
    });
  } catch (err: any) {
    console.error("[warmup-monitor/sync-campaigns] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

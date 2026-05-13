import pool from "@/lib/db";
import {
  MANUAL_REPLIES_CHANNEL,
  postToSlack as postToSlackShared,
} from "@/lib/slack-approval";

let running = false;

export async function runAutoReplySweep(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const { processAutoReply } = await import("@/app/api/auto-reply/processor");

    // ── 1. Reset stuck 'processing' replies → 'new' ──────────────────────────
    // Cause: container restart or crash killed the in-flight processor call.
    // Fix: reset to 'new' so the sweeper picks them up on the next tick.
    // Do NOT mark as 'errored' — errored means we gave up, not that we restarted.
    const stuckProcessing = await pool.query(
      `UPDATE replies
         SET status = 'new'
       WHERE status = 'processing'
         AND received_at <= NOW() - INTERVAL '30 minutes'
       RETURNING id, workspace_slug, lead_name, lead_email`
    );
    if (stuckProcessing.rows.length > 0) {
      stuckProcessing.rows.forEach(row =>
        console.warn(`[self-sweep] Reset stuck processing→new: ${row.workspace_slug} / ${row.lead_name} <${row.lead_email}>`)
      );
    }

    // ── 2. Auto-retry 'errored' replies once (single retry) ──────────────────
    // Cause: crash handler marked them errored. Most common cause is container
    // restart. Retry once by resetting to 'new'. If they error again, they stay
    // errored and a human handles it on the next working day.
    const retryErrored = await pool.query(
      `UPDATE replies
         SET status = 'new',
             ai_analysis = COALESCE(ai_analysis, '{}'::jsonb) || '{"retry_attempted":true}'::jsonb
       WHERE status = 'errored'
         AND received_at > NOW() - INTERVAL '6 hours'
         AND (ai_analysis->>'retry_attempted') IS NULL
         AND workspace_slug NOT IN ('itg-group', 'sonaro-ai', 'sro-consulting')
       RETURNING id, workspace_slug, lead_name, lead_email`
    );
    if (retryErrored.rows.length > 0) {
      retryErrored.rows.forEach(row =>
        console.warn(`[self-sweep] Auto-retry errored→new: ${row.workspace_slug} / ${row.lead_name} <${row.lead_email}>`)
      );
    }

    // ── 3. Flag 'new' replies stuck > 4 hours (sweeper should have caught these) ──
    // Something is wrong if a reply is still 'new' after 4 hours. Log + alert,
    // but DO NOT mark errored — leave them for the sweeper to process.
    const stuck4h = await pool.query(
      `SELECT id, workspace_slug, lead_name, lead_email, received_at
       FROM replies
       WHERE status = 'new'
         AND received_at <= NOW() - INTERVAL '4 hours'
         AND workspace_slug NOT IN ('itg-group', 'sonaro-ai', 'sro-consulting')
       LIMIT 20`
    );
    if (stuck4h.rows.length > 0) {
      const list = stuck4h.rows.map(r => `• ${r.workspace_slug} / ${r.lead_name}`).join("\n");
      console.error(`[self-sweep] ${stuck4h.rows.length} replies stuck at 'new' for 4+ hours:\n${list}`);
      // Only alert Slack if there are 3+ stuck replies (to avoid noise from single edge cases)
      if (stuck4h.rows.length >= 3) {
        await postToSlackShared({
          channel: MANUAL_REPLIES_CHANNEL,
          text: `Auto-reply sweeper warning: ${stuck4h.rows.length} replies stuck at 'new' for 4+ hours. The sweeper may have stopped. Check server logs.`,
          blocks: [
            { type: "header", text: { type: "plain_text", text: "Sweeper health warning", emoji: true } },
            { type: "section", text: { type: "mrkdwn", text: `*${stuck4h.rows.length} replies stuck at 'new' for 4+ hours.*\nThe auto-reply sweeper may have stopped or crashed. Check Coolify server logs immediately.\n\n${list}` } },
          ],
        }).catch(() => {});
      }
    }

    // ── 4. Alert on 'awaiting_approval' replies stuck > 48 hours ─────────────
    // If nobody approves in Slack, the lead gets no reply and no FU sequence.
    // Post a one-time reminder. Check once per sweep but only alert if not already alerted.
    const oldApproval = await pool.query(
      `SELECT r.id, r.workspace_slug, r.lead_name, r.lead_email, r.received_at, rd.slack_ts
       FROM replies r
       JOIN reply_drafts rd ON rd.reply_id = r.id
       WHERE r.status = 'awaiting_approval'
         AND r.received_at <= NOW() - INTERVAL '48 hours'
         AND rd.status = 'pending'
         AND (rd.body::text NOT LIKE '%awaiting_approval_alerted%')
       LIMIT 10`
    );
    if (oldApproval.rows.length > 0) {
      const list = oldApproval.rows.map(r => `• ${r.workspace_slug} / ${r.lead_name}`).join("\n");
      await postToSlackShared({
        channel: MANUAL_REPLIES_CHANNEL,
        text: `${oldApproval.rows.length} reply draft(s) have been waiting for approval in #reply-approval for 48+ hours. These leads have not received a reply.`,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Approval backlog — action needed", emoji: true } },
          { type: "section", text: { type: "mrkdwn", text: `*${oldApproval.rows.length} lead(s) waiting 48h+ for reply approval.*\nCheck #reply-approval and approve or reject these drafts. Leads are receiving nothing until approved.\n\n${list}` } },
        ],
      }).catch(() => {});

      // Mark alerted so we don't spam every 60s.
      const ids = oldApproval.rows.map(r => r.id);
      await pool.query(
        `UPDATE reply_drafts SET body = body || ' <!-- awaiting_approval_alerted -->'
         WHERE reply_id = ANY($1::uuid[]) AND status = 'pending'`,
        [ids]
      );
    }

    // ── 5. Main sweep: process 'new' replies ──────────────────────────────────
    const r = await pool.query(
      `SELECT id, workspace_slug
       FROM replies
       WHERE status = 'new'
         AND received_at > NOW() - INTERVAL '48 hours'
         AND workspace_slug NOT IN ('itg-group', 'sonaro-ai', 'sro-consulting')
       ORDER BY received_at ASC
       LIMIT 20`
    );

    if (r.rows.length === 0) return;

    let ok = 0;
    let fail = 0;
    for (const row of r.rows) {
      try {
        await processAutoReply(row.id, row.workspace_slug);
        ok++;
      } catch (err: any) {
        fail++;
        console.error(`[self-sweep] FAIL ${row.workspace_slug} ${row.id}: ${err?.message ?? err}`);
      }
    }

    if (ok > 0 || fail > 0) {
      console.log(`[self-sweep] processed ok=${ok} fail=${fail} (total picked=${r.rows.length})`);
    }
  } finally {
    running = false;
  }
}

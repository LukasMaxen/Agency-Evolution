import pool from "@/lib/db";

let running = false;

// Track which reply IDs we've already sent an awaiting_approval alert for this session.
// Resets on container restart, which is acceptable — one re-alert on restart is fine.
const approvalAlertedIds = new Set<string>();

export async function runAutoReplySweep(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const { processAutoReply } = await import("@/app/api/auto-reply/processor");

    // ── 1. Reset stuck 'processing' replies → 'new' ──────────────────────────
    // Cause: container restart or crash killed the in-flight processor call.
    // Fix: reset to 'new' so the sweeper picks them up on the next tick.
    // Do NOT mark as 'errored' — errored means we gave up, not that we restarted.
    // Keyed off processing_started_at (when the row entered 'processing'), not
    // received_at. A normal processor call finishes in 5-30s, so 5 minutes in
    // 'processing' means the call died. This recovers a deploy-killed reply in
    // ~5 min instead of the old 30-min received_at window. COALESCE falls back to
    // received_at for rows claimed before migration 018 (processing_started_at NULL).
    const stuckProcessing = await pool.query(
      `UPDATE replies
         SET status = 'new'
       WHERE status = 'processing'
         AND COALESCE(processing_started_at, received_at) <= NOW() - INTERVAL '5 minutes'
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

    // ── 3. Flag unprocessed replies stuck > 4 hours (sweeper should have caught these) ──
    // Something is wrong if a reply is still unprocessed after 4 hours. Log + alert,
    // but DO NOT mark errored, leave them for the sweeper to process. Includes
    // status='read' rows because the user may have opened the reply before the
    // processor ran, which used to hide it from this alert.
    const stuck4h = await pool.query(
      `SELECT id, workspace_slug, lead_name, lead_email, received_at
       FROM replies
       WHERE auto_reply_processed_at IS NULL
         AND status IN ('new', 'read')
         AND received_at <= NOW() - INTERVAL '4 hours'
         AND workspace_slug NOT IN ('itg-group', 'sonaro-ai', 'sro-consulting')
       LIMIT 20`
    );
    if (stuck4h.rows.length > 0) {
      const list = stuck4h.rows.map(r => `${r.workspace_slug} / ${r.lead_name}`).join(", ");
      console.error(`[self-sweep] ${stuck4h.rows.length} replies stuck at 'new' for 4+ hours: ${list}`);
      // Log only — no Slack noise
    }

    // ── 4. Alert on 'awaiting_approval' replies stuck > 48 hours ─────────────
    // If nobody approves in Slack, the lead gets no reply and no FU sequence.
    // Post a one-time alert per reply (tracked in-process to avoid Slack spam).
    const oldApproval = await pool.query(
      `SELECT r.id, r.workspace_slug, r.lead_name, r.lead_email
       FROM replies r
       JOIN reply_drafts rd ON rd.reply_id = r.id
       WHERE r.status = 'awaiting_approval'
         AND r.received_at <= NOW() - INTERVAL '48 hours'
         AND rd.status = 'pending'
       LIMIT 10`
    );
    const unalerted = oldApproval.rows.filter(r => !approvalAlertedIds.has(r.id));
    if (unalerted.length > 0) {
      // Log only — approval channel is no longer used
      console.log(`[self-sweep] ${unalerted.length} reply draft(s) waiting 48h+ (approval flow deprecated)`);
      unalerted.forEach(r => approvalAlertedIds.add(r.id));
    }

    // ── 5. Main sweep: process replies the processor hasn't finished ──────────
    // Trigger is auto_reply_processed_at IS NULL. This catches both 'new' rows
    // (webhook arrived, processor never ran) and 'read' rows (user opened the
    // reply in the dashboard before the processor could run, which used to
    // strand them). 'processing' and 'errored' are excluded: 'processing' is
    // mid-flight, 'errored' is handled by the retry block above.
    //
    // Do NOT filter on ai_analysis IS NULL, the dashboard's /api/analyze also
    // writes that column when a human opens a reply, which would hide the row
    // from the sweeper even though the processor never ran.
    const r = await pool.query(
      `SELECT id, workspace_slug
       FROM replies
       WHERE auto_reply_processed_at IS NULL
         AND status IN ('new', 'read')
         AND received_at > NOW() - INTERVAL '48 hours'
         AND workspace_slug NOT IN ('itg-group', 'sonaro-ai', 'sro-consulting')
       ORDER BY received_at ASC
       LIMIT 20`
    );

    if (r.rows.length === 0) return;

    // Safety net: 3 minutes per reply. Normal replies take 5-30s. If one hangs
    // (zombie TCP connection that bypasses AbortController), it gets dropped here
    // so the rest of the batch can continue. The reply stays at 'processing' and
    // is reset to 'new' by the stuck-processing check on the next sweep cycle.
    const withDeadline = (id: string, slug: string): Promise<void> =>
      Promise.race([
        processAutoReply(id, slug),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`deadline exceeded (3min) for ${id}`)), 3 * 60_000)
        ),
      ]);

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < r.rows.length; i++) {
      const row = r.rows[i];
      try {
        await withDeadline(row.id, row.workspace_slug);
        ok++;
      } catch (err: any) {
        fail++;
        console.error(`[self-sweep] FAIL ${row.workspace_slug} ${row.id}: ${err?.message ?? err}`);
      }
      // 3-second pacing between Claude calls to prevent 20 back-to-back Sonnet calls
      // firing simultaneously on a burst. 20 replies × 3s = 60s, fits the 60s cycle.
      if (i < r.rows.length - 1) {
        await new Promise(res => setTimeout(res, 3000));
      }
    }

    if (ok > 0 || fail > 0) {
      console.log(`[self-sweep] processed ok=${ok} fail=${fail} (total picked=${r.rows.length})`);
    }
  } finally {
    running = false;
  }
}

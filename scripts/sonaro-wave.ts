import pool from "@/lib/db";
import { processAutoReply } from "@/app/api/auto-reply/processor";

async function main() {
  // Pending Sonaro replies — only the LATEST per lead (skip ones with a newer reply in DB)
  const candidates = await pool.query(`
    SELECT r1.id, r1.lead_name, r1.lead_email, r1.received_at,
           substring(r1.message from 1 for 120) AS preview
    FROM replies r1
    WHERE r1.workspace_slug='sonaro-ai'
      AND r1.status IN ('new','read')
      AND NOT EXISTS (
        SELECT 1 FROM replies r2
        WHERE r2.workspace_slug='sonaro-ai'
          AND r2.lead_email = r1.lead_email
          AND r2.id != r1.id
          AND r2.received_at > r1.received_at
      )
    ORDER BY r1.received_at DESC`);
  console.log(`Found ${candidates.rows.length} candidate replies (latest per lead). Triggering each:\n`);

  let cards = 0, closed = 0, manual = 0, errored = 0;
  for (const row of candidates.rows) {
    // Reset to clean state before trigger
    await pool.query(`UPDATE replies SET status='new', auto_reply_processed_at=NULL WHERE id=$1`, [row.id]);
    await pool.query(`DELETE FROM reply_drafts WHERE reply_id=$1`, [row.id]);
    const t0 = Date.now();
    try {
      await processAutoReply(row.id, "sonaro-ai");
    } catch (e: any) {
      console.log(`✗ ${row.lead_name.padEnd(15)} <${row.lead_email.padEnd(40)}> CRASH: ${e.message}`);
      errored++;
      continue;
    }
    const dt = Date.now() - t0;
    const after = await pool.query(`SELECT status FROM replies WHERE id=$1`, [row.id]);
    const draft = await pool.query(`SELECT slack_ts, subject FROM reply_drafts WHERE reply_id=$1 ORDER BY created_at DESC LIMIT 1`, [row.id]);
    const status = after.rows[0].status;
    const slackTs = draft.rows[0]?.slack_ts;
    if (slackTs) {
      const tag = status === "awaiting_manual" ? "MANUAL" : "APPROVAL";
      console.log(`✓ ${row.lead_name.padEnd(15)} <${row.lead_email.padEnd(40)}> → ${tag} card ts=${slackTs} (${dt}ms)`);
      if (status === "awaiting_manual") manual++; else cards++;
    } else if (status === "read") {
      console.log(`· ${row.lead_name.padEnd(15)} <${row.lead_email.padEnd(40)}> → silently closed (${dt}ms)`);
      closed++;
    } else {
      console.log(`? ${row.lead_name.padEnd(15)} <${row.lead_email.padEnd(40)}> → status=${status} no draft (${dt}ms)`);
      errored++;
    }
  }
  console.log(`\nSummary: ${cards} approval cards, ${manual} manual cards, ${closed} silently closed, ${errored} errored.`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });

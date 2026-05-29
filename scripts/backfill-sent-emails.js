#!/usr/bin/env node
// One-off backfill: sweep every workspace's EB Sent folder for manual replies
// in the last 14 days and insert matching rows into sent_emails. Mirrors the
// logic added to lib/emailbison-inbox-sync.ts but runs as a standalone script.
//
// Usage: node scripts/backfill-sent-emails.js [days]

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const days = Number(process.argv[2] || 14);
const lines = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n');
const env = {};
for (const l of lines) {
  const i = l.indexOf('=');
  if (i < 0) continue;
  const k = l.slice(0, i).trim();
  let v = l.slice(i + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  env[k] = v;
}

const c = new Client({ connectionString: env.DATABASE_URL, ssl: false });

(async () => {
  await c.connect();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const wss = await c.query(`
    SELECT id, name, slug, email_bison_api_key, email_bison_instance_url
    FROM workspaces
    WHERE email_bison_api_key IS NOT NULL
      AND email_bison_instance_url IS NOT NULL
      AND slug NOT IN ('itg-group', 'sonaro-ai', 'sro-consulting')
  `);

  let grandTotal = 0;
  let grandStatusFlips = 0;

  for (const ws of wss.rows) {
    let perWsInserts = 0;
    let perWsStatusFlips = 0;
    try {
      const r = await fetch(
        `${ws.email_bison_instance_url}/api/replies?per_page=250&type=Sent`,
        { headers: { Authorization: `Bearer ${ws.email_bison_api_key}` } }
      );
      if (!r.ok) {
        console.error(`[backfill] ${ws.slug} fetch failed: ${r.status}`);
        continue;
      }
      const body = await r.json();
      const items = body?.data ?? [];

      for (const item of items) {
        if (item.folder !== 'Sent') continue;
        const sentAt = new Date(item.date_received);
        if (sentAt.getTime() < cutoff) continue;

        const recipient = item.to_email_addresses?.[0]?.email_address ?? item.primary_to_email_address ?? null;
        if (!recipient) continue;

        const stableId = `eb-sent-${ws.slug}-${item.id}`;
        const dup = await c.query('SELECT 1 FROM sent_emails WHERE id = $1', [stableId]);
        if (dup.rows.length > 0) continue;

        const match = await c.query(
          `SELECT id, lead_name FROM replies
           WHERE workspace_slug = $1 AND lead_email = $2 AND received_at <= $3
           ORDER BY received_at DESC LIMIT 1`,
          [ws.slug, recipient, sentAt]
        );
        if (match.rows.length === 0) continue;

        const matchedReplyId = match.rows[0].id;
        const leadName = match.rows[0].lead_name ?? recipient;
        const bodyText = item.text_body ?? item.html_body ?? '';

        await c.query(
          `INSERT INTO sent_emails
             (id, reply_id, workspace_slug, lead_email, lead_name,
              email_type, subject, body, sent_at, sent_by)
           VALUES ($1, $2, $3, $4, $5, 'reply', $6, $7, $8, 'emailbison-manual')
           ON CONFLICT (id) DO NOTHING`,
          [stableId, matchedReplyId, ws.slug, recipient, leadName, item.subject ?? null, bodyText, sentAt]
        );

        const flip = await c.query(
          `UPDATE replies SET status='replied'
           WHERE id=$1 AND status IN ('new','awaiting_approval','awaiting_manual')
           RETURNING id`,
          [matchedReplyId]
        );

        perWsInserts++;
        perWsStatusFlips += flip.rowCount || 0;
      }

      if (perWsInserts > 0 || perWsStatusFlips > 0) {
        console.log(`[backfill] ${ws.slug}: +${perWsInserts} sent_emails, ${perWsStatusFlips} status flips`);
      }
      grandTotal += perWsInserts;
      grandStatusFlips += perWsStatusFlips;
    } catch (err) {
      console.error(`[backfill] ${ws.slug} failed:`, err?.message ?? err);
    }
  }

  console.log(`\nTotal: ${grandTotal} sent_emails inserted, ${grandStatusFlips} replies flipped to status=replied across ${wss.rows.length} workspaces (last ${days} days)`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// Usage: node scripts/check-thread.js <workspace_slug> <lead_email>
// Prints the full EmailBison thread for a lead in chronological order.
// Use this BEFORE drafting any reply to verify whether the lead has already
// been handled (e.g. Nicklas sent a manual reply directly in EmailBison).

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const [, , workspaceSlug, leadEmail] = process.argv;
if (!workspaceSlug || !leadEmail) {
  console.error('Usage: node scripts/check-thread.js <workspace_slug> <lead_email>');
  process.exit(1);
}

const lines = fs.readFileSync(path.join(__dirname, '..', '.env.local'),'utf8').split('\n');
const env = {};
for (const l of lines) {
  const i = l.indexOf('=');
  if (i < 0) continue;
  const k = l.slice(0, i).trim();
  let v = l.slice(i+1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  env[k] = v;
}

const c = new Client({connectionString: env.DATABASE_URL, ssl: false});
function stripHtml(s) {
  return (s||'')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  await c.connect();
  const w = await c.query(`SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug=$1`, [workspaceSlug]);
  if (!w.rows.length) { console.error('Workspace not found:', workspaceSlug); process.exit(1); }
  const { email_bison_api_key: key, email_bison_instance_url: url } = w.rows[0];

  const r = await fetch(`${url}/api/replies?per_page=50&search=${encodeURIComponent(leadEmail)}`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  if (!r.ok) { console.error('EmailBison status:', r.status, await r.text()); process.exit(1); }
  const j = await r.json();
  const items = (j?.data || []).slice().sort((a, b) => new Date(a.date_received || a.date_sent) - new Date(b.date_received || b.date_sent));

  console.log(`\n=== ${leadEmail} (${items.length} messages in thread) ===\n`);
  for (const item of items) {
    const ts = (item.date_received || item.date_sent || '').slice(0, 16).replace('T', ' ');
    const dir = item.folder === 'Sent' ? 'US →' : 'THEM →';
    const from = item.from_email_address || '?';
    const subj = (item.subject || '').slice(0, 60);
    console.log(`[${ts}] ${dir} ${from}   |   ${subj}`);
    const bodyText = stripHtml(item.text_body || item.html_body || '');
    const cutAt = bodyText.search(/On \w+,? \w+ \d+,? \d{4}.* wrote:|wrote:/);
    const trimmed = cutAt > 0 ? bodyText.slice(0, cutAt) : bodyText;
    console.log(`  ${trimmed.slice(0, 350)}${trimmed.length > 350 ? '…' : ''}`);
    if (item.folder === 'Sent' && item.to_email_addresses) {
      const tos = item.to_email_addresses.map(t => t.email_address).join(', ');
      const ccs = (item.cc_email_addresses || []).map(t => t.email_address).join(', ');
      console.log(`  to: ${tos}${ccs ? ' | cc: ' + ccs : ''}`);
    }
    console.log('');
  }

  // Show meeting_booked / interested tags from latest item
  const latest = items[items.length - 1];
  if (latest) {
    console.log(`Latest message: folder=${latest.folder} interested=${latest.interested}`);
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });

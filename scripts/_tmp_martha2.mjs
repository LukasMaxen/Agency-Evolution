import fs from 'fs';
const envText = fs.readFileSync('.env.local', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { Pool } = await import('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const ws = await pool.query(`SELECT slug, auto_reply_approval_mode, forward_replies_to_email FROM workspaces WHERE slug = 'acceler8rs'`);
console.log('workspace:', JSON.stringify(ws.rows, null, 2));

const sent = await pool.query(`SELECT id, lead_email, email_type, subject, sent_at FROM sent_emails WHERE lead_email = 'martha.carlin@biotiquest.com' ORDER BY sent_at DESC LIMIT 10`);
console.log('sent_emails for martha:', JSON.stringify(sent.rows, null, 2));

const slacknote = await pool.query(`SELECT id, status, ai_analysis FROM replies WHERE id = 'a1d1854f-381b-4dcf-9faf-792b64e4501a'`);
console.log('reply ai_analysis:', JSON.stringify(slacknote.rows, null, 2));

await pool.end();

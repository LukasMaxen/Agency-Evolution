import fs from 'fs';
const envText = fs.readFileSync('.env.local', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { Pool } = await import('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const r = await pool.query(`
  SELECT id, workspace_slug, lead_email, lead_name, status, received_at, ai_analyzed_at,
         ai_analysis->>'intent' as intent,
         ai_analysis->>'skipped_reason' as skipped,
         ai_analysis->>'action' as action,
         ai_analysis->>'route_reason' as route_reason,
         LEFT(message, 200) as msg_preview
  FROM replies
  WHERE lead_email ILIKE '%martha.carlin%' OR lead_name ILIKE '%Martha Carlin%'
  ORDER BY received_at DESC LIMIT 10
`);
console.log(JSON.stringify(r.rows, null, 2));
await pool.end();

const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
pool.query(`SELECT id, workspace_slug, lead_email, lead_name, source, scheduled_at, status, created_at
  FROM calls WHERE workspace_slug = 'internal-campaigns' AND created_at >= '2026-08-18' ORDER BY created_at DESC`).then(r => {
  console.log(JSON.stringify(r.rows, null, 2));
  pool.end();
}).catch(e => { console.error(e); process.exit(1); });

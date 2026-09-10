// Onboard Client — SETUP: upsert a workspace row. Idempotent, safe to re-run
// (e.g. to rotate an API key later).
// Usage: node .claude/skills/onboard-client/setup.cjs <slug> "<Display Name>" <email_bison_api_key> <email_bison_instance_url>
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '../../..');
const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const g = k => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null; };
const pg = require(path.join(ROOT, 'node_modules', 'pg'));
const pool = new pg.Pool({ connectionString: g('DATABASE_URL'), ssl: false, max: 2 });

const [slug, name, apiKey, instanceUrl] = process.argv.slice(2);
if (!slug || !name || !apiKey || !instanceUrl) {
  console.error('Usage: node setup.cjs <slug> "<Display Name>" <email_bison_api_key> <email_bison_instance_url>');
  process.exit(1);
}

(async () => {
  const res = await pool.query(
    `INSERT INTO workspaces (id, slug, name, email_bison_api_key, email_bison_instance_url)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       email_bison_api_key = EXCLUDED.email_bison_api_key,
       email_bison_instance_url = EXCLUDED.email_bison_instance_url
     RETURNING id, slug, name, email_bison_instance_url`,
    [slug, name, apiKey, instanceUrl]
  );
  console.log('Upserted workspace:', res.rows[0]);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

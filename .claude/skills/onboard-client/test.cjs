// Onboard Client — TEST: verify a workspace end-to-end without touching Slack
// or a real lead.
//   1. EmailBison API key auth check (GET /api/workspaces with the stored key).
//   2. Fires a synthetic LEAD_REPLIED webhook at the production endpoint.
//   3. Confirms the row landed in `replies` under the right workspace_slug.
//   4. Deletes it immediately -- well inside the 2-minute auto-reply hold in
//      /api/auto-reply/run, so this never reaches Slack or a real send.
// Usage: node .claude/skills/onboard-client/test.cjs <slug>
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '../../..');
const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const g = k => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null; };
const pg = require(path.join(ROOT, 'node_modules', 'pg'));
const pool = new pg.Pool({ connectionString: g('DATABASE_URL'), ssl: false, max: 2 });
const APP_URL = process.env.APP_URL || 'https://inbox.agencyevolution.eu';

const slug = process.argv[2];
if (!slug) { console.error('Usage: node test.cjs <slug>'); process.exit(1); }

(async () => {
  let pass = true;

  const ws = await pool.query('SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug=$1', [slug]);
  if (!ws.rows.length) { console.log('[FAIL] no workspace row for', slug, '-- run setup.cjs first'); await pool.end(); process.exit(1); }
  const { email_bison_api_key: key, email_bison_instance_url: instance } = ws.rows[0];

  try {
    const r = await fetch(`${instance}/api/workspaces`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    const name = j?.data?.[0]?.name;
    console.log(r.ok ? `[PASS] EmailBison auth -- HTTP ${r.status}, workspace name: ${name}` : `[FAIL] EmailBison auth -- HTTP ${r.status}`);
    if (!r.ok) pass = false;
  } catch (e) { console.log('[FAIL] EmailBison auth --', e.message); pass = false; }

  const testId = `onboarding-test-${slug}-${Date.now()}`;
  const payload = {
    event: { type: 'LEAD_REPLIED' },
    data: {
      reply: {
        uuid: testId, id: 999999,
        text_body: 'Internal onboarding test message, not a real lead reply. Please ignore.',
        date_received: new Date().toISOString(),
        email_subject: '[TEST] onboarding verification',
        from_email_address: null, from_name: null,
        primary_to_email_address: 'test@internal-test.invalid',
      },
      lead: { email: 'test@internal-test.invalid', first_name: 'Internal', last_name: 'Test', id: 999999, company: 'Internal Test', title: 'Test' },
      campaign: { name: 'Onboarding Verification' },
      sender_email: { email: 'test-sender@internal-test.invalid', id: 0 },
    },
  };

  try {
    const r = await fetch(`${APP_URL}/api/webhook/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    console.log(r.ok && j.ok ? `[PASS] Webhook receiver -- HTTP ${r.status}, id ${j.id}` : `[FAIL] Webhook receiver -- HTTP ${r.status}, ${JSON.stringify(j)}`);
    if (!r.ok || !j.ok) pass = false;
  } catch (e) { console.log('[FAIL] Webhook receiver --', e.message); pass = false; }

  const row = await pool.query('SELECT workspace_slug, status FROM replies WHERE id=$1', [testId]);
  if (row.rows.length && row.rows[0].workspace_slug === slug) {
    console.log(`[PASS] DB insert confirmed -- status=${row.rows[0].status}`);
  } else {
    console.log('[FAIL] DB insert -- row not found or wrong workspace_slug');
    pass = false;
  }
  await pool.query('DELETE FROM replies WHERE id=$1', [testId]);
  console.log('[cleanup] test row deleted before the 2-minute auto-reply hold could fire a real Slack post.');

  console.log(pass ? '\n=== ALL CHECKS PASSED ===' : '\n=== SOME CHECKS FAILED -- do not consider this workspace live ===');
  await pool.end();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

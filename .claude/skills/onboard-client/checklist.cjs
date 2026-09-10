// Onboard Client — CHECKLIST: read-only status check for a client slug against
// every place the codebase treats workspaces specially. Never writes anything.
// Usage: node .claude/skills/onboard-client/checklist.cjs <slug>
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '../../..');
const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const g = k => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null; };
const pg = require(path.join(ROOT, 'node_modules', 'pg'));
const pool = new pg.Pool({ connectionString: g('DATABASE_URL'), ssl: false, max: 2 });

const slug = process.argv[2];
if (!slug) { console.error('Usage: node checklist.cjs <slug>'); process.exit(1); }

const readSrc = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function inSet(src, constName, needle) {
  const m = src.match(new RegExp(constName + '\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)'));
  if (!m) return null;
  return m[1].includes(`"${needle}"`) || m[1].includes(`'${needle}'`);
}
function aliasTarget(src, needle) {
  const m = src.match(new RegExp('"' + needle + '":\\s*"([^"]+)"'));
  return m ? m[1] : null;
}

(async () => {
  console.log(`\n=== Onboarding checklist: ${slug} ===\n`);

  const ws = await pool.query(
    'SELECT name, email_bison_instance_url, email_bison_api_key IS NOT NULL AS has_key, created_at FROM workspaces WHERE slug=$1',
    [slug]
  );
  if (ws.rows.length === 0) {
    console.log('[ ] DB workspace row -- MISSING. Run setup.cjs once you have the EmailBison workspace + API key.');
  } else {
    const w = ws.rows[0];
    console.log(`[x] DB workspace row -- name="${w.name}", instance=${w.email_bison_instance_url}, api_key=${w.has_key ? 'present' : 'MISSING'}`);
  }

  const clientFile = path.join(ROOT, 'clients', `${slug}.md`);
  if (fs.existsSync(clientFile)) {
    const content = fs.readFileSync(clientFile, 'utf8');
    const hasQuickRef = /^## REPLY QUICK REFERENCE/m.test(content);
    console.log(`[${hasQuickRef ? 'x' : '!'}] clients/${slug}.md exists${hasQuickRef ? '' : ' -- MISSING "## REPLY QUICK REFERENCE" heading. The auto-reply drafter looks for this exact heading and silently degrades to a full-file fallback without it.'}`);
  } else {
    console.log(`[ ] clients/${slug}.md -- MISSING. Run the intake interview (SKILL_IntakeClient.md) or write it directly.`);
  }

  const proc = readSrc('app/api/auto-reply/processor.ts');

  const alias = aliasTarget(proc, slug);
  console.log(alias
    ? `[i] CLIENT_FILE_ALIASES -- draws client content from clients/${alias}.md instead of its own file`
    : '[i] CLIENT_FILE_ALIASES -- none (uses its own client file directly)');

  const fullyAuto = inSet(proc, 'FULLY_AUTOMATED_WORKSPACES', slug);
  console.log(`[i] Automation tier -- ${fullyAuto
    ? 'FULLY AUTOMATED (auto-sends interested/needs_info with no human review -- high blast radius)'
    : 'standard (every interested/needs_info reply goes to #reply-approval or #manual-replies for human review -- this is the default and what a brand-new client should get unless explicitly told otherwise)'}`);

  const skipReply = inSet(proc, 'SKIP_WORKSPACES', slug);
  if (skipReply) console.log('[!] SKIP_WORKSPACES (processor.ts) -- this workspace is EXCLUDED from auto-reply entirely. Confirm that is intentional.');

  const cal = readSrc('lib/calendly.ts');
  const calEntry = cal.includes(`"${slug}":`);
  console.log(calEntry
    ? '[x] CALENDLY_CLIENT_CONFIG -- entry exists (lib/calendly.ts)'
    : '[ ] CALENDLY_CLIENT_CONFIG -- no entry. Fine if this client uses Fillout/iClosed or a plain Calendly link with no live-slot lookup; needed if you want live-slot suggestions.');

  console.log('\nAlways true, no action needed unless this client should be an exception:');
  console.log('  - Self-sweeper, CSM update, sender-sync, follow-up cron: all DB-driven, every workspaces row is included automatically.');
  console.log('  - workspaces.calendly_token / calendly_event_type_uri columns: DEAD, not read anywhere in code. Ignore them.');
  console.log('  - workspaces.auto_reply_approval_mode column: DEAD, never read anywhere. Ignore it.');
  console.log('\nStill manual, no script can do these:');
  console.log('  - Creating the EmailBison workspace itself and getting its API key (EmailBison dashboard).');
  console.log('  - Registering the webhook in EmailBison (URL + events -- see SKILL.md for the exact list).');
  console.log('  - Domain/sender warmup, DNS (SPF/DKIM/DMARC), Airtable base creation if this client needs a meetings tracker.');

  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

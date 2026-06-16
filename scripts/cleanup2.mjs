import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const MANUAL_CHANNEL = 'C0B0MMMMNKZ';

async function postManual(lead, ws, reason, orig) {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SLACK_TOKEN}` },
    body: JSON.stringify({
      channel: MANUAL_CHANNEL,
      text: `Manual action needed: ${ws} / ${lead}`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `Manual needed: ${ws} / ${lead}`, emoji: true } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Reason:* ${reason}\n\n*Lead's message:*\n> ${(orig || '').slice(0, 300).replace(/\n/g, '\n> ')}` } },
      ],
    }),
  });
}

async function killDrafts(where, killSequence = true) {
  const r = await pool.query(`SELECT id, follow_up_id FROM follow_up_drafts WHERE ${where}`);
  if (r.rows.length === 0) return 0;
  const ids = r.rows.map(x => x.id);
  const fuIds = [...new Set(r.rows.map(x => x.follow_up_id))];
  await pool.query(`UPDATE follow_up_drafts SET status='rejected', reviewed_at=NOW(), reviewed_by='system-audit-2' WHERE id=ANY($1)`, [ids]);
  if (killSequence) {
    await pool.query(`UPDATE follow_ups SET next_fu_due=NULL, outcome='closed_on_intent' WHERE id=ANY($1)`, [fuIds]);
  }
  console.log(`Killed ${ids.length} drafts${killSequence ? ' + sequences' : ''}: ${where.slice(0, 70)}`);
  return ids.length;
}

async function run() {
  // Kill hard close / wrong target sequences
  await killDrafts(`workspace_slug='911-restoration' AND lead_name='Christopher' AND status='pending'`);
  await killDrafts(`workspace_slug='911-restoration' AND lead_name='Mickey' AND status='pending'`);
  await killDrafts(`workspace_slug='act-capital' AND lead_name='Nate' AND status='pending'`);  // disqualified (revenue <$300K)
  await killDrafts(`workspace_slug='statera-capital' AND lead_name='George' AND status='pending'`);
  await killDrafts(`workspace_slug='statera-capital' AND lead_name='Alessandro' AND status='pending'`);  // Marco said hard no
  await killDrafts(`workspace_slug='venture-exits' AND lead_name='Alain' AND status='pending'`);  // not relevant
  await killDrafts(`workspace_slug='venture-exits' AND lead_name='Evan' AND status='pending'`);   // pass
  await killDrafts(`workspace_slug='venture-exits' AND lead_name='Ivan' AND status='pending'`);   // booked Wednesday
  await killDrafts(`workspace_slug='zebs-ibs' AND lead_name='Cindy' AND status='pending'`);
  await killDrafts(`workspace_slug='zebs-ibs' AND lead_name='Tereza' AND status='pending'`);
  await killDrafts(`workspace_slug='larsen-digital' AND lead_name='Manindra' AND status='pending'`);

  // Kill only nudge drafts (keep step-back content, reject nudge duplicates)
  await killDrafts(`workspace_slug='statera-capital' AND lead_name='Dinesh' AND status='pending' AND body LIKE '%Had a chance%'`, false);
  await killDrafts(`workspace_slug='statera-capital' AND lead_name='John' AND status='pending' AND body LIKE '%Had a chance%'`, false);
  await killDrafts(`workspace_slug='wrobel-capital' AND lead_name='Bob' AND status='pending' AND body LIKE '%Had a chance%'`, false);
  await killDrafts(`workspace_slug='zebs-ibs' AND lead_name='Josh' AND status='pending' AND body LIKE '%Had a chance%'`, false);
  await killDrafts(`workspace_slug='act-capital' AND lead_name='Imelda' AND status='pending' AND body LIKE '%Had a chance%'`, false);

  // Mark Ivan's follow_up as booked (he confirmed Wednesday)
  const ivanFu = await pool.query(`SELECT fu.id FROM follow_ups fu JOIN replies r ON r.id = fu.reply_id WHERE fu.workspace_slug='venture-exits' AND r.lead_name='Ivan' AND fu.next_fu_due IS NULL AND fu.outcome='closed_on_intent' LIMIT 1`);
  if (ivanFu.rows.length > 0) {
    await pool.query(`UPDATE follow_ups SET meeting_booked=TRUE, outcome='booked' WHERE id=$1`, [ivanFu.rows[0].id]);
  }

  // Route phone/specific-time leads to manual
  const manualLeads = [
    {
      ws: 'internal-campaigns', lead: 'Brian Victor',
      reason: '"Call me at 720-878-9184 please" — explicit phone call request. Do not send any FU. Someone needs to call Brian or route to Lukas.',
    },
    {
      ws: 'internal-campaigns', lead: 'VJ Jonusas',
      reason: '"I\'m open to a phone conversation." — phone call requested. Post the Calendly link manually or route to Lukas to book.',
    },
    {
      ws: 'statera-capital', lead: 'Parag',
      reason: '"Lets connect tomorrow" + phone +91 9004322200. Specific day given and phone number in message. Book manually.',
    },
  ];

  for (const m of manualLeads) {
    const r = await pool.query(
      `SELECT fd.id, fd.follow_up_id, r.message FROM follow_up_drafts fd JOIN replies r ON r.id = fd.reply_id WHERE fd.workspace_slug=$1 AND fd.lead_name=$2 AND fd.status='pending'`,
      [m.ws, m.lead]
    );
    if (r.rows.length > 0) {
      const ids = r.rows.map(x => x.id);
      const fuIds = [...new Set(r.rows.map(x => x.follow_up_id))];
      await pool.query(`UPDATE follow_up_drafts SET status='rejected', reviewed_at=NOW(), reviewed_by='system-audit-manual' WHERE id=ANY($1)`, [ids]);
      await pool.query(`UPDATE follow_ups SET next_fu_due=NULL, outcome='awaiting_manual' WHERE id=ANY($1)`, [fuIds]);
      await postManual(m.lead, m.ws, m.reason, r.rows[0].message);
      console.log(`Routed to manual: ${m.lead} (${m.ws})`);
    }
  }

  const final = await pool.query(`SELECT COUNT(*) as c FROM follow_up_drafts WHERE status='pending'`);
  const finalRd = await pool.query(`SELECT COUNT(*) as c FROM reply_drafts WHERE status='pending'`);
  console.log(`\nFinal: ${final.rows[0].c} pending FU drafts, ${finalRd.rows[0].c} pending reply drafts`);
  pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); });

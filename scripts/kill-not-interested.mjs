import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const NOT_INTERESTED = [
  'not interested', 'no thank', 'not relevant', 'take a pass', 'we are all set',
  'all set thanks', 'not something we', 'not in our charter', 'pass but thanks',
  'not looking at selling', 'not looking to sell', 'not for us', 'no interest',
  'not open for such', 'not the right fit', 'evco is not interested',
  'will take a pass', 'not in our mandate', 'not in our agenda',
];

const allPending = await pool.query(`
  SELECT fd.id, fd.follow_up_id, fd.lead_name, fd.workspace_slug, r.message
  FROM follow_up_drafts fd JOIN replies r ON r.id = fd.reply_id
  WHERE fd.status='pending'
`);

const toKill = allPending.rows.filter(r => {
  const orig = (r.message || '').toLowerCase();
  return NOT_INTERESTED.some(p => orig.includes(p));
});

console.log('Not-interested FU drafts to kill:', toKill.length);
toKill.forEach(r => console.log(' ', r.workspace_slug + '/' + r.lead_name, ':', (r.message || '').slice(0, 70)));

if (toKill.length > 0) {
  const ids = toKill.map(r => r.id);
  const fuIds = [...new Set(toKill.map(r => r.follow_up_id))];
  await pool.query(`UPDATE follow_up_drafts SET status='rejected', reviewed_at=NOW(), reviewed_by='system-not-interested' WHERE id=ANY($1)`, [ids]);
  await pool.query(`UPDATE follow_ups SET next_fu_due=NULL, outcome='closed_on_intent' WHERE id=ANY($1)`, [fuIds]);
}

const remaining = await pool.query(`SELECT COUNT(*) as c FROM follow_up_drafts WHERE status='pending'`);
console.log('Remaining pending FU drafts:', remaining.rows[0].c);
pool.end();

// Upwork proposals: Slack + state helper. Static, never edit per run.
//   node upwork.cjs unseen <id> <id> ...   prints ids not evaluated before (does NOT mark them)
//   node upwork.cjs mark <id> <id> ...     marks ids as evaluated (call for every job you dropped or carded)
//   node upwork.cjs post <cards.json>      posts one approval card per job to #upwork-approval
//   node upwork.cjs approved               prints approved, not yet submitted cards as JSON
//   node upwork.cjs spent                  prints Connects spent today (local date)
//   node upwork.cjs done <ts> <connects>   marks a card submitted (rocket) and adds to today's spend
//   node upwork.cjs fail <ts> "<reason>"   marks a card failed (warning reaction + thread note)
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.resolve(__dirname, '../../..');
const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const TOKEN = (env.match(/^SLACK_BOT_TOKEN=(.*)$/m) || [])[1].trim().replace(/^['"]|['"]$/g, '');
const CH = 'C0C9JHB59FU'; // #upwork-approval
const DIR = path.join(os.homedir(), '.upwork-proposals');
const SEEN = path.join(DIR, 'seen.txt');
const SPEND = path.join(DIR, 'spend.json'); // { "YYYY-MM-DD": connects }
const APPROVE = new Set(['white_check_mark', 'heavy_check_mark', '+1', 'ballot_box_with_check']);
const STOP = new Set(['rocket', 'x', 'warning', 'no_entry']);
fs.mkdirSync(DIR, { recursive: true });

const slack = async (m, p) => (await fetch('https://slack.com/api/' + m, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(p),
})).json();
const noDash = s => String(s || '').replace(/\s*[—–]\s*/g, ', ');
// Slack escapes &<> and wraps links as <url|label>; undo that for text Kasper typed
const unslack = s => String(s || '')
  .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>]+)>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const today = () => new Date().toLocaleDateString('sv-SE'); // local YYYY-MM-DD
const readSpend = () => { try { return JSON.parse(fs.readFileSync(SPEND, 'utf8')); } catch { return {}; } };

const [cmd, ...args] = process.argv.slice(2);
(async () => {
  if (cmd === 'unseen' || cmd === 'mark') {
    const seen = new Set(fs.existsSync(SEEN) ? fs.readFileSync(SEEN, 'utf8').split('\n') : []);
    const fresh = [...new Set(args)].filter(id => id && !seen.has(id));
    if (cmd === 'mark') { if (fresh.length) fs.appendFileSync(SEEN, fresh.join('\n') + '\n'); console.log('marked', fresh.length); }
    else console.log(fresh.join(' ') || '(none)');
    return;
  }

  if (cmd === 'post') {
    const cards = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    for (const c of cards) {
      const draft = noDash(c.draft);
      const meta = [c.type, c.budget, c.client, c.proposals, `${c.connects} connects`].filter(Boolean).join('  |  ');
      const blocks = [
        { type: 'section', text: { type: 'mrkdwn', text: `*<https://www.upwork.com/jobs/${c.id}|${noDash(c.title)}>*\n${meta}\n_Why:_ ${noDash(c.why)}` } },
        { type: 'section', text: { type: 'mrkdwn', text: draft.slice(0, 2900) } },
      ];
      if (c.answers && c.answers.length) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Screening answers*\n' + c.answers.map((a, i) => `A${i + 1}. _${noDash(a.q)}_\n${noDash(a.a)}`).join('\n\n').slice(0, 2900) } });
      }
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '✅ submit  |  ❌ skip  |  thread reply: full new text replaces the draft, a short note gets applied as an instruction, `A1: ...` overrides a screening answer. Then ✅' }] });
      const r = await slack('chat.postMessage', {
        channel: CH, text: `Upwork: ${noDash(c.title)}`, blocks, unfurl_links: false,
        metadata: { event_type: 'upwork_proposal', event_payload: { id: c.id, draft, answers: JSON.stringify(c.answers || []) } },
      });
      console.log(r.ok ? 'posted ' + c.id : 'FAILED ' + c.id + ' ' + r.error);
    }
    return;
  }

  if (cmd === 'approved') {
    const oldest = String(Math.floor(Date.now() / 1000) - 7 * 86400);
    const h = await slack('conversations.history', { channel: CH, oldest, limit: 200, include_all_metadata: true });
    if (!h.ok) return console.log('slack err', h.error);
    const out = [];
    for (const m of (h.messages || []).reverse()) { // oldest first, so older approvals go out first
      if (m.metadata?.event_type !== 'upwork_proposal') continue;
      const rx = (m.reactions || []).map(r => r.name);
      if (!rx.some(r => APPROVE.has(r)) || rx.some(r => r !== 'warning' && STOP.has(r))) continue;
      const p = m.metadata.event_payload;
      const answers = JSON.parse(p.answers || '[]');
      let text = p.draft; const notes = [];
      if (rx.includes('warning') && !m.reply_count) continue;
      if (m.reply_count) {
        const t = await slack('conversations.replies', { channel: CH, ts: m.ts });
        // a failed card (warning) is retried only once Kasper has replied after the last failure note
        if (rx.includes('warning')) {
          const msgs = (t.messages || []).slice(1);
          const lastFail = Math.max(0, ...msgs.filter(x => x.bot_id).map(x => +x.ts));
          if (!msgs.some(x => !x.bot_id && +x.ts > lastFail)) continue;
        }
        for (const x of (t.messages || []).slice(1).filter(x => !x.bot_id && x.text)) {
          const body = unslack(x.text).trim();
          if (/^A\d+:/.test(body)) {
            body.split(/\n(?=A\d+:)/).forEach(seg => {
              const mm = seg.match(/^A(\d+):\s*([\s\S]*)/);
              if (mm && answers[mm[1] - 1]) answers[mm[1] - 1].a = mm[2].trim();
            });
            continue;
          }
          if (body.length >= 250) { text = noDash(body); notes.length = 0; } // full replacement resets earlier notes
          else notes.push(body);
        }
      }
      out.push({ ts: m.ts, id: p.id, text, notes, answers });
    }
    console.log(JSON.stringify(out, null, 1));
    return;
  }

  if (cmd === 'spent') { console.log(readSpend()[today()] || 0); return; }

  if (cmd === 'done' || cmd === 'fail') {
    const [ts, extra] = args;
    await slack('reactions.add', { channel: CH, timestamp: ts, name: cmd === 'done' ? 'rocket' : 'warning' });
    if (cmd === 'fail') await slack('chat.postMessage', { channel: CH, thread_ts: ts, text: 'Not submitted: ' + noDash(extra) });
    if (cmd === 'done') {
      const s = readSpend(); s[today()] = (s[today()] || 0) + (parseInt(extra, 10) || 0);
      fs.writeFileSync(SPEND, JSON.stringify(s));
      console.log('done', ts, '| spent today', s[today()]);
    } else console.log('fail', ts);
    return;
  }

  console.log('usage: unseen | mark | post <file> | approved | spent | done <ts> <connects> | fail <ts> <reason>');
})();

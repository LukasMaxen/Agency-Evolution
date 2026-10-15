// Upwork proposals: Slack + seen-state helper. Static, never edit per run.
//   node upwork.cjs unseen <id> <id> ...   prints ids not seen before, then marks ALL given ids seen
//   node upwork.cjs post <cards.json>      posts one approval card per job to #upwork-approval
//   node upwork.cjs approved               prints approved, not yet submitted cards as JSON
//   node upwork.cjs done <ts>              marks a card submitted (rocket reaction)
//   node upwork.cjs fail <ts> "<reason>"   marks a card failed (warning reaction + thread note)
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.resolve(__dirname, '../../..');
const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const TOKEN = (env.match(/^SLACK_BOT_TOKEN=(.*)$/m) || [])[1].trim().replace(/^['"]|['"]$/g, '');
const CH = 'C0C9JHB59FU'; // #upwork-approval
const SEEN = path.join(os.homedir(), '.upwork-proposals', 'seen.txt');
const APPROVE = new Set(['white_check_mark', 'heavy_check_mark', '+1', 'ballot_box_with_check']);
const STOP = new Set(['rocket', 'x', 'warning', 'no_entry']);

const slack = async (m, p) => (await fetch('https://slack.com/api/' + m, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(p),
})).json();
const noDash = s => String(s || '').replace(/\s*[—–]\s*/g, ', ');

const [cmd, ...args] = process.argv.slice(2);
(async () => {
  if (cmd === 'unseen') {
    fs.mkdirSync(path.dirname(SEEN), { recursive: true });
    const seen = new Set(fs.existsSync(SEEN) ? fs.readFileSync(SEEN, 'utf8').split('\n') : []);
    const fresh = args.filter(id => !seen.has(id));
    if (fresh.length) fs.appendFileSync(SEEN, fresh.join('\n') + '\n');
    console.log(fresh.join(' ') || '(none)');
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
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Screening answers*\n' + c.answers.map((a, i) => `${i + 1}. _${noDash(a.q)}_\n${noDash(a.a)}`).join('\n\n').slice(0, 2900) } });
      }
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '✅ submit as is  |  reply in thread with full new text to edit, then ✅  |  ❌ skip' }] });
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
    for (const m of h.messages || []) {
      if (m.metadata?.event_type !== 'upwork_proposal') continue;
      const rx = (m.reactions || []).map(r => r.name);
      if (!rx.some(r => APPROVE.has(r)) || rx.some(r => STOP.has(r))) continue;
      const p = m.metadata.event_payload;
      let text = p.draft;
      if (m.reply_count) {
        const t = await slack('conversations.replies', { channel: CH, ts: m.ts });
        const human = (t.messages || []).slice(1).filter(x => !x.bot_id && x.text);
        if (human.length) text = noDash(human[human.length - 1].text);
      }
      out.push({ ts: m.ts, id: p.id, text, answers: JSON.parse(p.answers || '[]') });
    }
    console.log(JSON.stringify(out, null, 1));
    return;
  }

  if (cmd === 'done' || cmd === 'fail') {
    const [ts, reason] = args;
    await slack('reactions.add', { channel: CH, timestamp: ts, name: cmd === 'done' ? 'rocket' : 'warning' });
    if (cmd === 'fail') await slack('chat.postMessage', { channel: CH, thread_ts: ts, text: 'Not submitted: ' + noDash(reason) });
    console.log(cmd, ts);
    return;
  }

  console.log('usage: unseen | post <file> | approved | done <ts> | fail <ts> <reason>');
})();

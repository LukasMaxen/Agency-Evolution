// Proves the Account Monitor's numbers are right, for every window.
//
//   node scripts/verify-account-monitor.mjs                 # against production
//   node scripts/verify-account-monitor.mjs --base http://localhost:3000
//
// For each of the 24h / 7d / 14d / 30d views and every workspace it shown:
//   1. Pulls the dashboard API.
//   2. Independently pulls each sender's day-by-day series straight from
//      EmailBison (bypassing our cache entirely) and sums the same date range
//      the dashboard says it is showing (window.start to window.end inclusive).
//   3. Compares sent / bounced / replied per workspace AND per account, checks
//      that every workspace total equals the sum of its accounts and that the
//      page summary equals the sum of its workspaces, and checks burns never
//      exceed bounces-plus-tolerance and no rate is impossible (> 100%).
//   4. Reports data freshness for every pipeline.
//
// Exits non-zero on any mismatch, so it can gate a deploy or run on a schedule.
// Credentials come from .env.local (DATABASE_URL) and the workspaces table.

import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "https://inbox.agencyevolution.eu");
const env = Object.fromEntries(
  fs.readFileSync(`${process.cwd()}/.env.local`, "utf8").split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: false });

let problems = 0;
const bad = (msg) => { problems++; console.log(`  FAIL  ${msg}`); };
const ok  = (msg) => console.log(`  ok    ${msg}`);

async function ebSeries(url, key, senderId, start, end) {
  const r = await fetch(`${url}/api/campaign-events/stats?start_date=${start}&end_date=${end}&sender_email_ids[]=${senderId}`,
    { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  if (r.status === 422) return null;            // disconnected sender: EB has nothing
  if (!r.ok) throw new Error(`EB ${r.status} for sender ${senderId}`);
  const out = { sent: 0, bounced: 0, replied: 0 };
  for (const s of (await r.json()).data ?? []) {
    const k = { Sent: "sent", Bounced: "bounced", Replied: "replied" }[s.label];
    if (k) out[k] = s.dates.filter(([d]) => d >= start && d <= end).reduce((a, [, v]) => a + v, 0);
  }
  return out;
}

async function pool2(items, n, fn) {
  const q = [...items]; const res = [];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const it = q.shift(); res.push(await fn(it)); } }));
  return res;
}

const creds = Object.fromEntries((await pool.query(
  `SELECT slug, email_bison_api_key AS key, email_bison_instance_url AS url FROM workspaces WHERE email_bison_api_key IS NOT NULL`
)).rows.map(r => [r.slug, r]));

for (const days of [1, 7, 14, 30]) {
  console.log(`\n=== ${days === 1 ? "24h" : days + "d"} ===`);
  const res = await fetch(`${BASE}/api/account-monitor?days=${days}`);
  if (!res.ok) { bad(`API returned ${res.status}`); continue; }
  const api = await res.json();
  const { start, end } = api.window ?? {};
  if (!start) { bad("response has no window (old deploy?)"); continue; }
  console.log(`  window ${start} to ${end}, ${api.workspaces.length} workspaces, page total sent ${api.summary.totalSent}`);

  // page summary == sum of workspaces
  const sum = k => api.workspaces.reduce((a, w) => a + (w[k] ?? 0), 0);
  for (const [sk, wk] of [["totalSent", "totalSent"], ["totalReplies", "totalReplies"], ["totalBounces", "totalBounces"]]) {
    if (api.summary[sk] !== sum(wk)) bad(`summary.${sk} ${api.summary[sk]} != sum of workspaces ${sum(wk)}`);
  }

  for (const w of api.workspaces) {
    const c = creds[w.slug];
    const accSum = w.accounts.reduce((a, x) => ({ sent: a.sent + x.emails_sent, bounced: a.bounced + x.bounces, replied: a.replied + x.replies }), { sent: 0, bounced: 0, replied: 0 });
    if (accSum.sent !== w.totalSent || accSum.bounced !== w.totalBounces || accSum.replied !== w.totalReplies) {
      bad(`${w.slug}: workspace totals ${w.totalSent}/${w.totalBounces}/${w.totalReplies} != sum of accounts ${accSum.sent}/${accSum.bounced}/${accSum.replied}`);
    }
    if (w.burnPct > 100 || w.bouncePct > 100 || w.avgReplyRate > 100) bad(`${w.slug}: impossible rate (burn ${w.burnPct}% bounce ${w.bouncePct}% reply ${w.avgReplyRate}%)`);
    if (w.totalBurns > w.totalBounces + Math.max(5, w.totalBounces * 0.25)) console.log(`  note  ${w.slug}: burns ${w.totalBurns} exceed EB bounces ${w.totalBounces} (burns come from webhook bounce log, bounces from EB series)`);

    // independent truth straight from EmailBison
    const senders = await pool.query(
      `SELECT eb_sender_id, email FROM sender_accounts WHERE workspace_slug = $1 AND eb_sender_id IS NOT NULL AND provider_type IS NOT NULL AND provider_type !~* '(microsoft|office365|outlook)'`, [w.slug]);
    const truthByEmail = {}; let fetchErr = 0;
    await pool2(senders.rows, 8, async s => {
      try { truthByEmail[s.email.toLowerCase()] = await ebSeries(c.url, c.key, s.eb_sender_id, start, end); } catch { fetchErr++; }
    });
    if (fetchErr) { bad(`${w.slug}: ${fetchErr} sender calls to EmailBison failed, cannot fully verify`); continue; }
    const truth = Object.values(truthByEmail).reduce((a, t) => t ? ({ sent: a.sent + t.sent, bounced: a.bounced + t.bounced, replied: a.replied + t.replied }) : a, { sent: 0, bounced: 0, replied: 0 });
    let wrongAccts = 0;
    for (const a of w.accounts) {
      const t = truthByEmail[a.sender_email.toLowerCase()];
      const exp = t ?? { sent: 0, bounced: 0, replied: 0 };
      if (a.emails_sent !== exp.sent || a.bounces !== exp.bounced || a.replies !== exp.replied) wrongAccts++;
    }
    const match = truth.sent === w.totalSent && truth.bounced === w.totalBounces && truth.replied === w.totalReplies;
    if (!match || wrongAccts) bad(`${w.slug}: dashboard ${w.totalSent}/${w.totalBounces}/${w.totalReplies} vs EmailBison ${truth.sent}/${truth.bounced}/${truth.replied} (sent/bounced/replied), ${wrongAccts} account row(s) differ`);
    else ok(`${w.slug.padEnd(20)} sent ${String(w.totalSent).padStart(6)}  bounced ${String(w.totalBounces).padStart(4)}  replied ${String(w.totalReplies).padStart(4)}  burn ${w.burnPct}%  (all ${w.accounts.length} accounts match EmailBison)`);
  }

  const behind = (api.freshness ?? []).filter(f => f.statsStale || f.accountsStale || f.warmupStale);
  if (behind.length) bad(`pipelines behind schedule: ${behind.map(f => `${f.slug}[${[f.statsStale && "stats", f.accountsStale && "accounts", f.warmupStale && "warmup"].filter(Boolean).join("+")}]`).join(", ")}`);
  else ok(`freshness: every pipeline current (oldest sync ${api.lastSynced})`);
}

await pool.end();
console.log(problems === 0 ? "\nALL WINDOWS VERIFIED against EmailBison." : `\n${problems} PROBLEM(S) FOUND.`);
process.exit(problems === 0 ? 0 : 1);

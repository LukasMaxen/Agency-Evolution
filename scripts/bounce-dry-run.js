// Dry-run harness for the bounce classifier.
// Pulls /api/replies?type=Bounced from every workspace (including the ones
// currently excluded from the inbox sync), classifies each bounce received
// in the last 48h, and reports global plus per-domain breakdowns.
// No DB writes.

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { Pool } = require('pg');

// Load DATABASE_URL from .env.local without pulling in dotenv.
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnvLocal();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

// Promise wrapper around https.request so we do not depend on global fetch.
function httpGet(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        headers,
      },
      (res) => {
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(body); } catch (e) { /* leave null */ }
          resolve({ status: res.statusCode, body, json });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('request timeout')));
    req.end();
  });
}

// Inlined classifier (mirrors the proposed lib/bounce-classifier.ts).
const GMAIL_FAILURE = /Delivery Status Notification \(Failure\)/i;
const GMAIL_DELAY   = /Delivery Status Notification \(Delay\)/i;
const OUTLOOK_SUBJ  = /^Undeliverable:/i;
const POSTFIX_SUBJ  = /Undelivered Mail Returned to Sender/i;

const DOMAIN_BURN  = [
  /\b5\.7\.\d+\b/,                          // broadened: catches 5.7.1, 5.7.509 (DMARC), 5.7.606 (RBL), etc.
  /\b4\.7\.500\b/,
  /\bClient host blocked\b/i,
  /\b451\b.*(?:rate|throttl|spam|block)/i,
];
const DATA_FAILURE = [
  /\b5\.1\.\d+\b/,                          // broadened: 5.1.1, 5.1.10, future variants
  /\bUser Unknown\b/i,
  /\bwasn'?t found at\b/i,                  // EOP plain-English form
  /\b5\.2\.\d+\b/,
  /\b5\.4\.\d+\b/,                          // new: Postfix routing failures
];
const SOFT = [
  /\b4\.\d+\.\d+\b/,
  /\bmailbox full\b/i,
];

function extractSmtpCode(body) {
  const m = body.match(/\b([45]\.\d+\.\d+)\b/);
  return m ? m[1] : null;
}
function detectProvider(fromEmail, body) {
  const f = (fromEmail || '').toLowerCase();
  if (f.includes('googlemail.com') || f.endsWith('@google.com')) return 'google';
  if (f.startsWith('postmaster@') || /Microsoft SMTP|Office 365|EOP/i.test(body)) return 'microsoft';
  if (f.startsWith('mailer-daemon@') || /Postfix/i.test(body)) return 'postfix';
  return 'other';
}
function classifyBounce({ subject, textBody, fromEmail }) {
  const s = subject || '';
  const b = textBody || '';
  const f = fromEmail || '';
  const smtp = extractSmtpCode(b);
  const provider = detectProvider(f, b);

  if (GMAIL_FAILURE.test(s)) return { category: 'data_failure', provider: 'google', rule: 'gmail_failure_subject', smtp };
  if (GMAIL_DELAY.test(s))   return { category: 'domain_burn',  provider: 'google', rule: 'gmail_delay_subject',   smtp };

  const bodyDriven = OUTLOOK_SUBJ.test(s) || POSTFIX_SUBJ.test(s) || provider === 'microsoft' || provider === 'postfix';
  if (bodyDriven) {
    for (const re of DOMAIN_BURN)  if (re.test(b)) return { category: 'domain_burn',  provider, rule: re.source, smtp };
    for (const re of DATA_FAILURE) if (re.test(b)) return { category: 'data_failure', provider, rule: re.source, smtp };
    for (const re of SOFT)         if (re.test(b)) return { category: 'soft',         provider, rule: re.source, smtp };
  }
  return { category: 'unknown', provider, rule: 'no_match', smtp };
}

(async () => {
  const wss = await pool.query(`
    SELECT slug, email_bison_instance_url AS url, email_bison_api_key AS key
    FROM workspaces
    WHERE email_bison_api_key IS NOT NULL AND email_bison_instance_url IS NOT NULL
    ORDER BY slug
  `);

  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const globalCounts   = { data_failure: 0, domain_burn: 0, soft: 0, unknown: 0 };
  const providerCounts = {};
  const ruleHits       = {};
  const byDomain       = {};
  const fetchErrors    = [];
  let   totalFetched   = 0;
  let   totalAnalyzed  = 0;
  let   skippedNoSender = 0;
  let   skippedNotBounce = 0;

  // Sample buckets for regex refinement. Capped at 5 each.
  const sampleAny       = [];   // any unknown / no_match
  const sampleMicrosoft = [];   // provider microsoft that fell to unknown
  const sampleOther     = [];   // provider postfix or other that fell to unknown
  const captureSample = (bucket, item, cls, ws) => {
    if (bucket.length >= 5) return;
    bucket.push({
      workspace: ws.slug,
      provider:  cls.provider,
      smtp:      cls.smtp,
      from:      item.from_email_address || '',
      subject:   item.subject || '',
      body:      (item.text_body || '').slice(0, 300).replace(/\s+/g, ' ').trim(),
    });
  };

  for (const ws of wss.rows) {
    try {
      const url = ws.url + '/api/replies?type=Bounced&per_page=250';
      const res = await httpGet(url, {
        Authorization: 'Bearer ' + ws.key,
        Accept: 'application/json',
      });
      if (res.status !== 200) { fetchErrors.push(ws.slug + ': HTTP ' + res.status); continue; }
      const items = (res.json && res.json.data) || [];
      totalFetched += items.length;

      for (const item of items) {
        if (!item.uuid) continue;
        const ts = new Date(item.date_received).getTime();
        if (ts < cutoff) continue;

        // Pre-filter: EB files some human replies under the Bounced folder
        // (false positives). Real bounce DSNs are automated and come from
        // standard daemon mailboxes, so drop anything that does not look
        // like a daemon-originated automated message.
        const fromAddr = (item.from_email_address || '').toLowerCase();
        const looksLikeBounce =
          item.automated_reply === true ||
          /^(postmaster|mailer-daemon|noreply|no-reply|bounce)@/i.test(fromAddr);
        if (!looksLikeBounce) { skippedNotBounce++; continue; }

        const cls = classifyBounce({
          subject:   item.subject,
          textBody:  item.text_body,
          fromEmail: item.from_email_address,
        });

        totalAnalyzed++;
        globalCounts[cls.category]++;
        providerCounts[cls.provider] = (providerCounts[cls.provider] || 0) + 1;
        ruleHits[cls.rule] = (ruleHits[cls.rule] || 0) + 1;

        if (cls.category === 'unknown') {
          captureSample(sampleAny, item, cls, ws);
          if (cls.provider === 'microsoft')                              captureSample(sampleMicrosoft, item, cls, ws);
          if (cls.provider === 'postfix' || cls.provider === 'other')    captureSample(sampleOther, item, cls, ws);
        }

        const sender = item.primary_to_email_address || '';
        if (!sender.includes('@')) { skippedNoSender++; continue; }
        const domain = sender.split('@')[1].toLowerCase();
        const key = ws.slug + '::' + domain;
        if (!byDomain[key]) byDomain[key] = {
          workspace_slug: ws.slug, domain,
          data_failure: 0, domain_burn: 0, soft: 0, unknown: 0, total: 0,
          accounts: new Set(),
        };
        byDomain[key][cls.category]++;
        byDomain[key].total++;
        byDomain[key].accounts.add(sender);
      }
    } catch (e) {
      fetchErrors.push(ws.slug + ': ' + e.message);
    }
  }

  const line = '='.repeat(60);
  console.log(line);
  console.log('  BOUNCE CLASSIFIER DRY-RUN, last 48 hours');
  console.log(line);
  console.log('Workspaces polled:           ' + wss.rows.length);
  console.log('Bounce items fetched (raw):  ' + totalFetched);
  console.log('Bounce items in 48h window:  ' + (totalAnalyzed + skippedNotBounce));
  console.log('Filtered (not a real DSN):   ' + skippedNotBounce);
  console.log('Bounces actually classified: ' + totalAnalyzed);
  console.log('Skipped (no sender_email):   ' + skippedNoSender);
  if (fetchErrors.length) {
    console.log('Fetch errors:                ' + fetchErrors.length);
    fetchErrors.forEach(e => console.log('  ! ' + e));
  }
  console.log();

  console.log('## Category breakdown');
  for (const k of ['data_failure', 'domain_burn', 'soft', 'unknown']) {
    const pct = totalAnalyzed ? ((globalCounts[k] / totalAnalyzed) * 100).toFixed(1) : '0.0';
    console.log('  ' + k.padEnd(14) + String(globalCounts[k]).padStart(5) + '  (' + pct + '%)');
  }
  console.log();

  console.log('## Provider breakdown');
  for (const [p, n] of Object.entries(providerCounts).sort((a,b) => b[1] - a[1])) {
    console.log('  ' + p.padEnd(12) + String(n).padStart(5));
  }
  console.log();

  console.log('## Top matched rules');
  for (const [r, n] of Object.entries(ruleHits).sort((a,b) => b[1] - a[1]).slice(0, 12)) {
    console.log('  ' + r.padEnd(34) + n);
  }
  console.log();

  const ranked = Object.values(byDomain).sort((a,b) => b.total - a.total).slice(0, 8);
  console.log('## Top domains by 48h bounce volume');
  for (const d of ranked) {
    console.log(
      '  [' + d.workspace_slug.padEnd(20) + '] ' +
      d.domain.padEnd(36) +
      ' total ' + String(d.total).padStart(4) +
      '  burn ' + String(d.domain_burn).padStart(3) +
      '  fail ' + String(d.data_failure).padStart(3) +
      '  soft ' + String(d.soft).padStart(3) +
      '  unk '  + String(d.unknown).padStart(3) +
      '  accts ' + d.accounts.size
    );
  }
  console.log();

  // Dump samples for regex refinement.
  const dumpSamples = (label, arr) => {
    console.log('## Samples: ' + label + ' (' + arr.length + ')');
    if (arr.length === 0) { console.log('  (none)'); console.log(); return; }
    arr.forEach((s, i) => {
      console.log('  [' + (i + 1) + '] ws=' + s.workspace + '  provider=' + s.provider + '  smtp=' + (s.smtp || 'none'));
      console.log('      from:    ' + s.from);
      console.log('      subject: ' + s.subject);
      console.log('      body:    ' + s.body);
    });
    console.log();
  };
  dumpSamples('unknown / no_match, any provider',         sampleAny);
  dumpSamples('unknown that was provider=microsoft',      sampleMicrosoft);
  dumpSamples('unknown that was provider=postfix/other',  sampleOther);

  const focusList = Object.values(byDomain).sort((a,b) => (b.domain_burn - a.domain_burn) || (b.total - a.total));
  const focus = focusList[0];
  if (focus) {
    console.log('## Focus workspace + domain, 48h rolling');
    console.log('Workspace: ' + focus.workspace_slug);
    console.log('Domain:    ' + focus.domain);

    // Look up EB credentials for the focus workspace.
    const wsRow = wss.rows.find(w => w.slug === focus.workspace_slug);

    // Build a 3-calendar-day window that fully covers the 48h bounce window.
    // The CSM update uses the same /api/workspaces/v1.1/stats endpoint.
    const toYmd = (d) => d.toISOString().slice(0, 10);
    const today = new Date();
    const startDate = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
    const statsUrl = wsRow.url + '/api/workspaces/v1.1/stats'
      + '?start_date=' + toYmd(startDate)
      + '&end_date='   + toYmd(today);

    const statsRes = await httpGet(statsUrl, {
      Authorization: 'Bearer ' + wsRow.key,
      Accept: 'application/json',
    });

    const accountsRes = await pool.query(
      "SELECT email FROM sender_accounts " +
      "WHERE workspace_slug = $1 AND LOWER(SPLIT_PART(email, '@', 2)) = $2 " +
      "ORDER BY email",
      [focus.workspace_slug, focus.domain]
    );

    let wsSent = 0, wsReplies = 0, wsBouncedEB = 0;
    if (statsRes.status === 200 && statsRes.json && statsRes.json.data) {
      wsSent      = statsRes.json.data.emails_sent ?? 0;
      wsReplies   = statsRes.json.data.unique_replies_per_contact ?? 0;
      wsBouncedEB = statsRes.json.data.bounced ?? 0;
    } else {
      console.log('!! EB stats fetch failed: HTTP ' + statsRes.status);
    }

    // Workspace-wide bounce totals from this run, summed across all domains.
    let wsBouncesAll = 0, wsDomainBurn = 0, wsDataFailure = 0, wsSoft = 0, wsUnknown = 0;
    for (const d of Object.values(byDomain)) {
      if (d.workspace_slug !== focus.workspace_slug) continue;
      wsBouncesAll += d.total;
      wsDomainBurn += d.domain_burn;
      wsDataFailure += d.data_failure;
      wsSoft += d.soft;
      wsUnknown += d.unknown;
    }

    console.log();
    console.log('Window for EB stats: ' + toYmd(startDate) + ' to ' + toYmd(today) + ' (covers the 48h bounce window).');
    console.log();
    console.log('## Workspace-level metrics (denominator from EB stats API)');
    console.log('EB emails_sent:        ' + wsSent);
    console.log('EB replies:            ' + wsReplies);
    console.log('EB bounced (their #):  ' + wsBouncedEB);
    console.log('Our classified bounces: ' + wsBouncesAll
      + '   (burn ' + wsDomainBurn + ' / fail ' + wsDataFailure + ' / soft ' + wsSoft + ' / unk ' + wsUnknown + ')');
    console.log();

    if (wsSent > 0) {
      const reply  = wsReplies / wsSent * 100;
      const bounce = wsBouncesAll / wsSent * 100;
      const delay  = wsDomainBurn / wsSent * 100;
      const tag = (ok) => ok ? 'PASS' : 'FAIL';
      console.log('Reply Rate:        ' + reply.toFixed(2)  + '%   (target >= 1.00%)   ' + tag(reply  >= 1.0));
      console.log('Total Bounce Rate: ' + bounce.toFixed(2) + '%   (target <  2.00%)   ' + tag(bounce <  2.0));
      console.log('Delay Rate:        ' + delay.toFixed(2)  + '%   (target <  0.50%)   ' + tag(delay  <  0.5));
    } else {
      console.log('EB reports zero sends in window, rates not computable.');
    }
    console.log();

    console.log('## Focus domain breakdown (subset of the workspace numbers above)');
    console.log('Accounts registered under domain: ' + accountsRes.rows.length);
    console.log('Accounts that bounced (48h):       ' + focus.accounts.size);
    console.log('Total bounces (48h):               ' + focus.total);
    console.log('  of which domain_burn:            ' + focus.domain_burn);
    console.log('  of which data_failure:           ' + focus.data_failure);
    console.log('  of which soft:                   ' + focus.soft);
    console.log('  of which unknown:                ' + focus.unknown);
    console.log();

    if (accountsRes.rows.length) {
      console.log('## Level 3, per-account drill-down');
      for (const a of accountsRes.rows) {
        const acctSent = await pool.query(
          "SELECT COUNT(*)::int AS n FROM emails_sent " +
          "WHERE workspace_slug = $1 AND sender_email = $2 AND sent_at >= NOW() - INTERVAL '48 hours'",
          [focus.workspace_slug, a.email]
        );
        const tag = focus.accounts.has(a.email) ? '(has bounces)' : '(no bounces in 48h)';
        console.log('  ' + a.email.padEnd(45) + ' sent ' + String(acctSent.rows[0].n).padStart(4) + '  ' + tag);
      }
    }
  } else {
    console.log('No bounces in the 48h window across any workspace.');
  }

  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

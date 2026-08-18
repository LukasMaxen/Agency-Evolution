import fs from 'fs';
import { Pool } from 'pg';

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const START_DATE = '2026-08-17';
const END_DATE = '2026-08-17';

const EXCLUDED_SLUGS = new Set([
  'micro-nordic',
  'sro-consulting',
  'zenith-global',
  'venture-exits',
  'zebs-ibs',
  'wrobel-capital',
  'itg-group',
  '911-restoration',
]);

const AIRTABLE_MEETINGS_CONFIG = {
  'act-capital': { base: 'appECObQrdSRjeXeM', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'acceler8rs': { base: 'appV8wpBdqTgCi4Ws', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date', extraFilter: "{Deal Source} = 'Cold email (Acceler8rs)'" },
  'gn-motion': { base: 'appL5fZEyULdqpyx5', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'hahnbeck': { base: 'appUZr45I0MK7uv3w', table: 'tbl9KatGYqPFB45Hs', field: 'Meeting booked date' },
  'internal-campaigns': { base: 'app9rWZ2iE4eWECEN', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date' },
  'larsen-digital': { base: 'appV8wpBdqTgCi4Ws', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date', extraFilter: "{Deal Source} = 'Cold email (LD)'" },
  'sonaro-ai': { base: 'appNMGCTwXVOLLzmA', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'statera-capital': { base: 'app0EI3nqT3ScUJOf', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
};

const REPORT_LABELS = {
  'internal-campaigns': 'Internal Campaigns',
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 5 });

const { rows: workspaces } = await pool.query(
  "SELECT slug, name, email_bison_instance_url, email_bison_api_key FROM workspaces ORDER BY slug"
);
await pool.end();

const results = [];

for (const ws of workspaces) {
  if (EXCLUDED_SLUGS.has(ws.slug)) continue;
  if (!ws.email_bison_api_key || !ws.email_bison_instance_url) continue;

  const url = new URL(`${ws.email_bison_instance_url}/api/workspaces/v1.1/stats`);
  url.searchParams.set('start_date', START_DATE);
  url.searchParams.set('end_date', END_DATE);

  let stats = { emails_sent: 0, unique_replies_per_contact: 0, interested: 0 };
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ws.email_bison_api_key}` },
    });
    if (res.ok) {
      const json = await res.json();
      stats = json.data ?? stats;
    } else {
      stats.error = `HTTP ${res.status}`;
    }
  } catch (e) {
    stats.error = String(e.message || e);
  }

  let meetings = 0;
  const cfg = AIRTABLE_MEETINGS_CONFIG[ws.slug];
  if (cfg) {
    const dateFilter = `IS_SAME({${cfg.field}}, '${START_DATE}', 'day')`;
    const formula = cfg.extraFilter ? `AND(${dateFilter}, ${cfg.extraFilter})` : dateFilter;
    const atUrl = new URL(`https://api.airtable.com/v0/${cfg.base}/${cfg.table}`);
    atUrl.searchParams.set('filterByFormula', formula);
    atUrl.searchParams.append('fields[]', cfg.field);
    try {
      const res = await fetch(atUrl, {
        headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
      });
      if (res.ok) {
        const json = await res.json();
        meetings = (json.records || []).length;
      }
    } catch (e) {
      meetings = `error: ${e.message || e}`;
    }
  }

  results.push({
    slug: ws.slug,
    label: REPORT_LABELS[ws.slug] || ws.name,
    emails_sent: stats.emails_sent ?? 0,
    total_replies: stats.unique_replies_per_contact ?? 0,
    interested: stats.interested ?? 0,
    meetings,
    error: stats.error,
  });
}

console.log(JSON.stringify(results, null, 2));

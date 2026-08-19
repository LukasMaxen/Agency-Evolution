const { Pool } = require('pg');

const DATE = '2026-08-18';

// Excluded per SKILL_CSMUpdate.md
const EXCLUDED = new Set([
  'micro-nordic', 'sro-consulting', 'zenith-global', 'venture-exits',
  'zebs-ibs', 'wrobel-capital', 'itg-group', '911-restoration'
]);

// Airtable meetings config from SKILL_CSMUpdate.md
const AIRTABLE_CONFIG = {
  'act-capital': { base: 'appECObQrdSRjeXeM', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'acceler8rs': { base: 'appV8wpBdqTgCi4Ws', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date', dealSource: 'Cold email (Acceler8rs)' },
  'larsen-digital': { base: 'appV8wpBdqTgCi4Ws', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date', dealSource: 'Cold email (LD)' },
  'gn-motion': { base: 'appL5fZEyULdqpyx5', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'hahnbeck': { base: 'appUZr45I0MK7uv3w', table: 'tbl9KatGYqPFB45Hs', field: 'Meeting booked date' },
  'internal-campaigns': { base: 'app9rWZ2iE4eWECEN', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date' },
  'sonaro-ai': { base: 'appNMGCTwXVOLLzmA', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'statera-capital': { base: 'app0EI3nqT3ScUJOf', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
};

const LABELS = {
  'act-capital': 'ACT Capital',
  'acceler8rs': 'Larsen Digital - Lukas',
  'larsen-digital': 'Larsen Digital - Nicklas',
  'gn-motion': 'GN Motion',
  'hahnbeck': 'Hahnbeck',
  'internal-campaigns': 'Internal Campaigns',
  'sonaro-ai': 'Sonaro AI',
  'statera-capital': 'Statera Capital',
};

async function fetchStats(instanceUrl, apiKey, date) {
  const url = `${instanceUrl}/api/workspaces/v1.1/stats?start_date=${date}&end_date=${date}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    return { error: `HTTP ${res.status}` };
  }
  const json = await res.json();
  return json.data || {};
}

async function fetchMeetings(slug, date) {
  const cfg = AIRTABLE_CONFIG[slug];
  if (!cfg) return null;
  let formula = `IS_SAME({${cfg.field}}, '${date}', 'day')`;
  if (cfg.dealSource) {
    formula = `AND(${formula}, {Deal Source} = '${cfg.dealSource}')`;
  }
  const params = new URLSearchParams();
  params.append('filterByFormula', formula);
  params.append('fields[]', cfg.field);
  const url = `https://api.airtable.com/v0/${cfg.base}/${cfg.table}?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const json = await res.json();
  return (json.records || []).length;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  const { rows } = await pool.query(
    'SELECT slug, name, email_bison_instance_url, email_bison_api_key FROM workspaces ORDER BY slug'
  );
  await pool.end();

  const results = [];
  for (const ws of rows) {
    if (EXCLUDED.has(ws.slug)) continue;
    if (!ws.email_bison_api_key || !ws.email_bison_instance_url) continue;

    const stats = await fetchStats(ws.email_bison_instance_url, ws.email_bison_api_key, DATE);
    const meetings = await fetchMeetings(ws.slug, DATE);

    results.push({
      slug: ws.slug,
      label: LABELS[ws.slug] || ws.name,
      sent: stats.emails_sent ?? 0,
      replies: stats.unique_replies_per_contact ?? 0,
      interested: stats.interested ?? 0,
      meetings: meetings,
      error: stats.error,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });

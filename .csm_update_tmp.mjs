import { Pool } from 'pg';
import fs from 'fs';

const envRaw = fs.readFileSync('/Users/kasperaggerholm/Agency-Evolution/.env.local', 'utf8');
const env = {};
for (const line of envRaw.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const START = '2026-09-02';
const END = '2026-09-02';

const EXCLUDED = new Set([
  'micro-nordic', 'sro-consulting', 'zenith-global', 'venture-exits',
  'zebs-ibs', 'wrobel-capital', 'itg-group', '911-restoration'
]);

const AIRTABLE = {
  'ah-consulting': { base: 'appZhEsVN52VXPZ66', table: 'tblTnxArHDVMNOxSI', field: 'Meeting booked date', label: 'AH Consulting' },
  'act-capital': { base: 'appECObQrdSRjeXeM', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date', label: 'ACT Capital' },
  'acceler8rs': { base: 'appp8h0kv9DEHYpXR', table: 'tblkoizZek5r5wi45', field: 'Meeting booked date', label: 'Larsen Digital - Lukas', dealSource: 'Lukas' },
  'gn-motion': { base: 'appL5fZEyULdqpyx5', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date', label: 'GN Motion' },
  'hahnbeck': { base: 'appUZr45I0MK7uv3w', table: 'tbl9KatGYqPFB45Hs', field: 'Meeting booked date', label: 'Hahnbeck' },
  'internal-campaigns': { base: 'app9rWZ2iE4eWECEN', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date', label: 'Internal Campaigns' },
  'larsen-digital': { base: 'appp8h0kv9DEHYpXR', table: 'tblkoizZek5r5wi45', field: 'Meeting booked date', label: 'Larsen Digital - Nicklas', dealSource: 'Nicklas' },
  'sonaro-ai': { base: 'appNMGCTwXVOLLzmA', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date', label: 'Sonaro AI' },
  'statera-capital': { base: 'app0EI3nqT3ScUJOf', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date', label: 'Statera Capital' },
  'with-pebble': { base: 'appjEe12UdVsRX10y', table: 'tblTnxArHDVMNOxSI', field: 'Meeting booked date', label: 'WithPebble' },
};

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: false });
  const { rows } = await pool.query(
    `SELECT slug, name, email_bison_instance_url, email_bison_api_key FROM workspaces ORDER BY slug`
  );
  await pool.end();

  const results = [];

  for (const ws of rows) {
    if (EXCLUDED.has(ws.slug)) continue;
    if (!ws.email_bison_instance_url || !ws.email_bison_api_key) continue;

    let stats = { emails_sent: 0, unique_replies_per_contact: 0, interested: 0 };
    try {
      const url = new URL('/api/workspaces/v1.1/stats', ws.email_bison_instance_url);
      url.searchParams.set('start_date', START);
      url.searchParams.set('end_date', END);
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${ws.email_bison_api_key}` } });
      const json = await resp.json();
      if (json && json.data) {
        stats = {
          emails_sent: json.data.emails_sent ?? 0,
          unique_replies_per_contact: json.data.unique_replies_per_contact ?? 0,
          interested: json.data.interested ?? 0,
        };
      } else {
        stats._error = `bad response: ${JSON.stringify(json).slice(0,200)}`;
      }
    } catch (e) {
      stats._error = e.message;
    }

    let meetings = 0;
    const at = AIRTABLE[ws.slug];
    if (at) {
      try {
        const url = new URL(`https://api.airtable.com/v0/${at.base}/${at.table}`);
        let formula = `IS_SAME({${at.field}}, '${START}', 'day')`;
        if (at.dealSource) {
          formula = `AND(${formula}, {Deal Source} = '${at.dealSource}')`;
        }
        url.searchParams.set('filterByFormula', formula);
        url.searchParams.append('fields[]', at.field);
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } });
        const json = await resp.json();
        meetings = (json.records || []).length;
        if (json.error) meetings = `ERR:${JSON.stringify(json.error)}`;
      } catch (e) {
        meetings = `ERR:${e.message}`;
      }
    } else {
      meetings = 'N/A';
    }

    results.push({
      slug: ws.slug,
      label: ws.name,
      emails_sent: stats.emails_sent,
      replies: stats.unique_replies_per_contact,
      interested: stats.interested,
      meetings,
      error: stats._error,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });

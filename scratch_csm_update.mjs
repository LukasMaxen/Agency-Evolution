import pg from 'pg';
import fs from 'fs';

// Load .env.local manually
const envRaw = fs.readFileSync('/Users/kasperaggerholm/Agency-Evolution/.env.local', 'utf8');
const env = {};
for (const line of envRaw.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const DATE = '2026-09-02';

const EXCLUDED = new Set([
  'micro-nordic', 'sro-consulting', 'zenith-global', 'venture-exits',
  'zebs-ibs', 'wrobel-capital', 'itg-group', '911-restoration'
]);

const AIRTABLE = {
  'ah-consulting': { base: 'appZhEsVN52VXPZ66', table: 'tblTnxArHDVMNOxSI', field: 'Meeting booked date' },
  'act-capital': { base: 'appECObQrdSRjeXeM', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'acceler8rs': { base: 'appp8h0kv9DEHYpXR', table: 'tblkoizZek5r5wi45', field: 'Meeting booked date', dealSource: 'Lukas' },
  'larsen-digital': { base: 'appp8h0kv9DEHYpXR', table: 'tblkoizZek5r5wi45', field: 'Meeting booked date', dealSource: 'Nicklas' },
  'gn-motion': { base: 'appL5fZEyULdqpyx5', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'hahnbeck': { base: 'appUZr45I0MK7uv3w', table: 'tbl9KatGYqPFB45Hs', field: 'Meeting booked date' },
  'internal-campaigns': { base: 'app9rWZ2iE4eWECEN', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date' },
  'sonaro-ai': { base: 'appNMGCTwXVOLLzmA', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'statera-capital': { base: 'app0EI3nqT3ScUJOf', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'with-pebble': { base: 'appjEe12UdVsRX10y', table: 'tblTnxArHDVMNOxSI', field: 'Meeting booked date' },
};

async function main() {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: false, max: 5 });
  const { rows: workspaces } = await pool.query(
    "SELECT slug, name, email_bison_instance_url, email_bison_api_key FROM workspaces ORDER BY slug"
  );

  const results = [];
  for (const ws of workspaces) {
    if (EXCLUDED.has(ws.slug)) continue;
    if (!ws.email_bison_api_key || !ws.email_bison_instance_url) continue;
    try {
      const url = `${ws.email_bison_instance_url}/api/workspaces/v1.1/stats?start_date=${DATE}&end_date=${DATE}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${ws.email_bison_api_key}` } });
      const json = await resp.json();
      const d = json.data || {};
      let meetings = null;
      const at = AIRTABLE[ws.slug];
      if (at) {
        let formula = `IS_SAME({${at.field}}, '${DATE}', 'day')`;
        if (at.dealSource) {
          formula = `AND(${formula}, {Deal Source} = '${at.dealSource}')`;
        }
        const atUrl = `https://api.airtable.com/v0/${at.base}/${at.table}?filterByFormula=${encodeURIComponent(formula)}&fields%5B%5D=${encodeURIComponent(at.field)}`;
        const atResp = await fetch(atUrl, { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } });
        const atJson = await atResp.json();
        meetings = Array.isArray(atJson.records) ? atJson.records.length : `ERR:${JSON.stringify(atJson).slice(0,200)}`;
      }
      results.push({
        slug: ws.slug,
        name: ws.name,
        emails_sent: d.emails_sent ?? 0,
        replies: d.unique_replies_per_contact ?? 0,
        interested: d.interested ?? 0,
        meetings,
        rawError: json.error || (resp.status !== 200 ? `HTTP ${resp.status}` : null)
      });
    } catch (e) {
      results.push({ slug: ws.slug, name: ws.name, error: e.message });
    }
  }

  // AH Consulting / Internal Campaigns cross-check
  const crossCheck = await pool.query(`
    SELECT c.workspace_slug, COUNT(*) AS n
    FROM calls c
    JOIN replies r ON r.lead_email = c.lead_email AND r.workspace_slug = c.workspace_slug
    WHERE (
        c.workspace_slug = 'ah-consulting'
        OR (c.workspace_slug = 'internal-campaigns' AND r.campaign ILIKE '%austinheaton%')
      )
      AND c.created_at >= $1 AND c.created_at < $2
    GROUP BY c.workspace_slug
  `, [`${DATE}T00:00:00`, `${DATE}T23:59:59.999`]);

  console.log(JSON.stringify({ results, crossCheck: crossCheck.rows }, null, 2));
  await pool.end();
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });

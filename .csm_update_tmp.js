const fs = require('fs');
const { Pool } = require('pg');

const env = fs.readFileSync('.env.local', 'utf8');
function getEnv(key) {
  const line = env.split('\n').find(l => l.startsWith(key + '='));
  if (!line) return null;
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
}

const dbUrl = getEnv('DATABASE_URL');
const airtableKey = getEnv('AIRTABLE_API_KEY');

const EXCLUDED = new Set([
  'micro-nordic',
  'sro-consulting',
  'zenith-global',
  'venture-exits',
  'zebs-ibs',
  'wrobel-capital',
  'itg-group',
  '911-restoration',
]);

const AIRTABLE_CONFIG = {
  'act-capital': { base: 'appECObQrdSRjeXeM', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'acceler8rs': { base: 'appV8wpBdqTgCi4Ws', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date', filter: "Cold email (Acceler8rs)" },
  'larsen-digital': { base: 'appV8wpBdqTgCi4Ws', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date', filter: "Cold email (LD)" },
  'gn-motion': { base: 'appL5fZEyULdqpyx5', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'hahnbeck': { base: 'appUZr45I0MK7uv3w', table: 'tbl9KatGYqPFB45Hs', field: 'Meeting booked date' },
  'internal-campaigns': { base: 'app9rWZ2iE4eWECEN', table: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date' },
  'sonaro-ai': { base: 'appNMGCTwXVOLLzmA', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  'statera-capital': { base: 'app0EI3nqT3ScUJOf', table: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
};

const date = process.argv[2];
if (!date) { console.error('usage: node csm_update.js YYYY-MM-DD'); process.exit(1); }

async function main() {
  const pool = new Pool({ connectionString: dbUrl, ssl: false });
  const { rows } = await pool.query(
    "SELECT slug, name, email_bison_instance_url, email_bison_api_key FROM workspaces ORDER BY slug"
  );
  await pool.end();

  const results = [];

  for (const ws of rows) {
    if (EXCLUDED.has(ws.slug)) continue;
    if (!ws.email_bison_api_key || !ws.email_bison_instance_url) continue;

    const statsUrl = new URL(`${ws.email_bison_instance_url}/api/workspaces/v1.1/stats`);
    statsUrl.searchParams.set('start_date', date);
    statsUrl.searchParams.set('end_date', date);

    let sent = 0, replies = 0, interested = 0;
    try {
      const resp = await fetch(statsUrl.toString(), {
        headers: { Authorization: `Bearer ${ws.email_bison_api_key}` },
      });
      const json = await resp.json();
      sent = json?.data?.emails_sent ?? 0;
      replies = json?.data?.unique_replies_per_contact ?? 0;
      interested = json?.data?.interested ?? 0;
    } catch (e) {
      console.error(`stats fetch failed for ${ws.slug}: ${e.message}`);
    }

    let meetings = 0;
    const cfg = AIRTABLE_CONFIG[ws.slug];
    if (cfg) {
      try {
        const atUrl = new URL(`https://api.airtable.com/v0/${cfg.base}/${cfg.table}`);
        let formula = `IS_SAME({${cfg.field}}, '${date}', 'day')`;
        if (cfg.filter) {
          formula = `AND(${formula}, {Deal Source} = '${cfg.filter}')`;
        }
        atUrl.searchParams.set('filterByFormula', formula);
        atUrl.searchParams.append('fields[]', cfg.field);
        const resp = await fetch(atUrl.toString(), {
          headers: { Authorization: `Bearer ${airtableKey}` },
        });
        const json = await resp.json();
        meetings = (json.records || []).length;
      } catch (e) {
        console.error(`airtable fetch failed for ${ws.slug}: ${e.message}`);
      }
    }

    results.push({ slug: ws.slug, name: ws.name, sent, replies, interested, meetings });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });

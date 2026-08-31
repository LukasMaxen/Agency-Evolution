import fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const AFTER = '2026-08-23';
const BEFORE = '2026-08-31';

const configs = [
  { slug: 'acceler8rs', baseId: 'appV8wpBdqTgCi4Ws', tableId: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date', dealSource: 'Lukas' },
  { slug: 'act-capital', baseId: 'appECObQrdSRjeXeM', tableId: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  { slug: 'ah-consulting', baseId: 'appZhEsVN52VXPZ66', tableId: 'tblTnxArHDVMNOxSI', field: 'Meeting booked date' },
  { slug: 'gn-motion', baseId: 'appL5fZEyULdqpyx5', tableId: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  { slug: 'hahnbeck', baseId: 'appUZr45I0MK7uv3w', tableId: 'tbl9KatGYqPFB45Hs', field: 'Meeting booked date' },
  { slug: 'internal-campaigns', baseId: 'app9rWZ2iE4eWECEN', tableId: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date' },
  { slug: 'larsen-digital', baseId: 'appV8wpBdqTgCi4Ws', tableId: 'tblCATnaPTV9fb2Ab', field: 'Meeting booked date', dealSource: 'Nicklas' },
  { slug: 'sonaro-ai', baseId: 'appNMGCTwXVOLLzmA', tableId: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  { slug: 'statera-capital', baseId: 'app0EI3nqT3ScUJOf', tableId: 'tblTnxArHDVMNOxSI', field: 'Meeting Booked Date' },
  { slug: 'with-pebble', baseId: 'appjEe12UdVsRX10y', tableId: 'tblTnxArHDVMNOxSI', field: 'Meeting booked date' },
];

async function main() {
  const results = [];
  for (const c of configs) {
    let formula = `AND(IS_AFTER({${c.field}}, '${AFTER}'), IS_BEFORE({${c.field}}, '${BEFORE}'))`;
    if (c.dealSource) {
      formula = `AND(${formula}, {Deal Source} = '${c.dealSource}')`;
    }
    const url = new URL(`https://api.airtable.com/v0/${c.baseId}/${c.tableId}`);
    url.searchParams.set('filterByFormula', formula);
    url.searchParams.append('fields[]', c.field);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
      });
      if (!res.ok) {
        const body = await res.text();
        results.push({ slug: c.slug, error: `HTTP ${res.status}: ${body.slice(0,200)}` });
        continue;
      }
      const json = await res.json();
      results.push({ slug: c.slug, meetings: (json.records || []).length });
    } catch (e) {
      results.push({ slug: c.slug, error: String(e.message || e) });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

main();

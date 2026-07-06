import { readFileSync } from 'fs';
const env = {};
for (const line of readFileSync('/Users/kasperaggerholm/Agency-Evolution/.env.local','utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,'');
}
const KEY = env.AIRTABLE_API_KEY;

// window June 29 - July 5 inclusive -> after Jun 28, before Jul 6
const clients = [
  { name:'911 Restoration', base:'appGTy1rR6eZjKu62', table:'tblVEhq27whUNk4KY', field:'Meeting booked date' },
  { name:'ACT Capital', base:'appECObQrdSRjeXeM', table:'tblTnxArHDVMNOxSI', field:'Meeting Booked Date' },
  { name:'Acceler8rs', base:'appV8wpBdqTgCi4Ws', table:'tblCATnaPTV9fb2Ab', field:'Meeting booked date', extra:"{Deal Source} = 'Cold email (Acceler8rs)'" },
  { name:'GN Motion', base:'appL5fZEyULdqpyx5', table:'tblTnxArHDVMNOxSI', field:'Meeting Booked Date' },
  { name:'Hahnbeck', base:'appUZr45I0MK7uv3w', table:'tbl9KatGYqPFB45Hs', field:'Meeting booked date' },
  { name:'Internal Campaigns', base:'app9rWZ2iE4eWECEN', table:'tblCATnaPTV9fb2Ab', field:'Meeting booked date' },
  { name:'Larsen Digital', base:'appmixoDAnp7FicCS', table:'tblB3gNeQNs29SMgO', field:'Meeting booked date' },
  { name:'Sonaro AI', base:'appNMGCTwXVOLLzmA', table:'tblTnxArHDVMNOxSI', field:'Meeting Booked Date' },
  { name:'Statera Capital', base:'app0EI3nqT3ScUJOf', table:'tblTnxArHDVMNOxSI', field:'Meeting Booked Date' },
];

for (const c of clients) {
  let dateF = `AND(IS_AFTER({${c.field}}, '2026-06-28'), IS_BEFORE({${c.field}}, '2026-07-06'))`;
  const formula = c.extra ? `AND(${dateF}, ${c.extra})` : dateF;
  let count = 0, offset = null;
  try {
    do {
      const u = new URL(`https://api.airtable.com/v0/${c.base}/${c.table}`);
      u.searchParams.set('filterByFormula', formula);
      u.searchParams.append('fields[]', c.field);
      if (offset) u.searchParams.set('offset', offset);
      const r = await fetch(u, { headers: { Authorization: `Bearer ${KEY}` } });
      if (!r.ok) { console.log(`${c.name}: ERR http ${r.status} ${await r.text()}`); count=null; break; }
      const j = await r.json();
      count += j.records.length;
      offset = j.offset;
    } while (offset);
    if (count !== null) console.log(`${c.name}: ${count}`);
  } catch(e) { console.log(`${c.name}: ERR ${e.message}`); }
}

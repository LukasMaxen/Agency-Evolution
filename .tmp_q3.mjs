import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:false});
const [w] = (await pool.query(`select email_bison_api_key k, email_bison_instance_url u from workspaces where slug='act-capital'`)).rows;
await pool.end();
const h={Authorization:`Bearer ${w.k}`,Accept:'application/json'};
const get = async p => { const r = await fetch(w.u+p,{headers:h}); const t = await r.text(); try { return {s:r.status, j:JSON.parse(t)} } catch { return {s:r.status, t:t.slice(0,200)} } };
// interested replies for campaign
let all=[];
for (let page=1; page<20; page++){
  const r = await get(`/api/replies?campaign_id=712&status=interested&page=${page}`);
  if (r.s!==200){ console.log('ERR', r); break; }
  all.push(...r.j.data);
  if (page===1) console.log('meta', JSON.stringify(r.j.meta), 'keys', Object.keys(r.j.data[0]||{}).join(','));
  if (!r.j.meta || page>=r.j.meta.last_page) break;
}
console.log('interested replies', all.length);
for (const x of all) console.log([x.date_received?.slice(0,10), x.from_email_address, x.from_name, x.campaign_id, x.interested, x.folder, x.type].join(' | '));
// attendee lookups
const att = `farra.alford@morganstanley.com hdavis@tetoncoast.com dkapelusznik@gmail.com eharris@thegrowthcoach.com nancyl@iconmediadirect.com ran@ranscapes.com jason@lifestreamwater.com gerson@dsrmcable.com bfell@buddybarcasting.com anh.hau1994@gmail.com jay.lehoczky@gs.com riley@soliscapital.com bruce@greatampack.com pauld@ecotech-imaging.com k@kennetharichard.com demetrius@kennetharichard.com tfratis@actcapitaladvisors.com russell@metrospireagency.com manishas@iconmediadirect.com william@globalelectric.us newtothesleeplesscity@gmail.com amir@camv.io robert.rosenstock@opco.com francesco@welcomehomehg.com rhuff@actcapitaladvisors.com suzie@theguru.co maarten@perennialfs.com peter@autolegends.com haibei.jiang@gmail.com mayra@clearpathexecution.com`.split(' ');
for (const e of att){
  const r = await get(`/api/leads?search=${encodeURIComponent(e)}`);
  const d = r.j?.data||[];
  const dom = e.split('@')[1];
  let dd=[];
  if (!/gmail|morganstanley|gs\.com|opco/.test(dom)) { const r2 = await get(`/api/leads?search=${encodeURIComponent('@'+dom)}`); dd=(r2.j?.data||[]).filter(l=>!d.find(y=>y.id===l.id)); }
  console.log(e, '=> exact:', d.map(l=>`${l.id} ${l.email} ${l.first_name} ${l.last_name} [${l.company}] status=${l.status} stats=${JSON.stringify(l.overall_stats||{})} camps=${JSON.stringify((l.lead_campaign_data||[]).map(c=>c.campaign_id||c.id))}`).join(' ; ')||'NONE', '| domain:', dd.map(l=>`${l.email} ${l.first_name} ${l.last_name}`).join(' ; ')||'none');
}

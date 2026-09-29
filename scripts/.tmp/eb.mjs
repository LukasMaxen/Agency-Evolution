import pg from 'pg'; import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).replace(/^"|"$/g,'')]));
const pool = new pg.Pool({connectionString: env.DATABASE_URL, ssl:false});
const {rows:[w]} = await pool.query("select email_bison_api_key k, email_bison_instance_url u from workspaces where slug='clpr-media'"); await pool.end();
const r = await fetch(`${w.u}/api/replies/1247345/conversation-thread`, {headers:{Authorization:`Bearer ${w.k}`}});
const j = await r.json(); const d = j.data||j;
const all = [...(d.older_messages||[]), d.current_reply, ...(d.newer_messages||[])].filter(Boolean).filter(m=>m.folder==="Sent");
for (const m of all) console.log(m.date_received||m.created_at, '|', m.folder, '|', m.type, '|', m.from_email_address, '->', m.to?.map?.(t=>t.address).join(',')||m.primary_to_email_address, '\n  ', (m.text_body||'').slice(0,900).replace(/\n+/g,' '));
if(!all.length) console.log(JSON.stringify(j).slice(0,1500));

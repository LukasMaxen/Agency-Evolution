import pg from 'pg'; import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).replace(/^"|"$/g,'')]));
const pool = new pg.Pool({connectionString: env.DATABASE_URL, ssl:false});
const {rows:[w]} = await pool.query("select email_bison_api_key k, email_bison_instance_url u from workspaces where slug='clpr-media'"); await pool.end();
for (const q of ['pietro@getquietlab.com','pietro@quietlab.com']) {
  const r = await fetch(`${w.u}/api/replies?per_page=50&search=${encodeURIComponent(q)}`, {headers:{Authorization:`Bearer ${w.k}`,Accept:'application/json'}});
  const j = await r.json();
  console.log(q, r.status, (j.data||[]).map(it=>[it.id,it.folder,it.date_received,it.date_sent,it.from_email_address].join(' ')));
}

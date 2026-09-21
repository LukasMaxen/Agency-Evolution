import pg from 'pg'; import fs from 'fs';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,'')]}));
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:false});await c.connect();
const {rows}=await c.query("select slug,name,email_bison_instance_url u,email_bison_api_key k from workspaces where slug ilike '%gn%' or name ilike '%gn%'");
for(const w of rows){console.log(w.slug,w.name,w.u);
 for(const [s,e] of [['2026-09-07','2026-09-13'],['2026-09-01','2026-09-13']]){
  const r=await fetch(`${w.u}/api/workspaces/v1.1/stats?start_date=${s}&end_date=${e}`,{headers:{Authorization:'Bearer '+w.k}});
  const j=await r.json();console.log(s,e,r.status,JSON.stringify(j.data??j).slice(0,400));}
 const q=await c.query("select date(sent_at) d,count(*) from emails_sent where workspace_slug=$1 and sent_at>='2026-09-01' group by 1 order by 1",[w.slug]);console.log(q.rows);}
await c.end();

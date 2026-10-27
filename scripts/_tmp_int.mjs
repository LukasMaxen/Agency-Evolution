import pg from "pg";
const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const w=(await p.query("select email_bison_api_key k,email_bison_instance_url u from workspaces where slug='mp-consulting'")).rows[0];await p.end();
const h={Authorization:`Bearer ${w.k}`,Accept:"application/json"};
const out=[];let page=1,stop=false,keys;
while(!stop&&page<40){const r=await (await fetch(`${w.u}/api/replies?per_page=100&page=${page}`,{headers:h})).json();const d=r.data||[];if(!keys&&d[0])keys=Object.keys(d[0]);
 for(const x of d){const dt=x.date_received||x.created_at;if(dt<"2026-10-01"){stop=true;continue}if(x.interested)out.push(x)}
 if(!d.length||!r.links?.next)break;page++}
console.log("keys:",keys?.join(","));
for(const x of out)console.log((x.date_received||x.created_at).slice(0,10),"|",x.from_name,"|",x.from_email_address,"|",x.folder,x.type,"|",(x.text_body||"").replace(/\s+/g," ").slice(0,160));

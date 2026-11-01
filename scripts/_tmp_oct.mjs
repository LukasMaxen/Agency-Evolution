import pg from "pg";
const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const A={Authorization:`Bearer ${process.env.AIRTABLE_API_KEY}`};
const inOct=d=>d>="2026-10-01"&&d<"2026-11-01";
async function cal(tok){const h={Authorization:`Bearer ${tok}`};const me=(await (await fetch("https://api.calendly.com/users/me",{headers:h})).json()).resource;
 let url=`https://api.calendly.com/scheduled_events?user=${encodeURIComponent(me.uri)}&min_start_time=2026-09-15T00:00:00Z&count=100`;const out=[];
 while(url){const r=await (await fetch(url,{headers:h})).json();for(const e of r.collection){for(const i of (await (await fetch(e.uri+"/invitees",{headers:h})).json()).collection)if(inOct(i.created_at.slice(0,10)))out.push({booked:i.created_at.slice(0,10),meet:e.start_time.slice(0,10),name:i.name,email:i.email.toLowerCase(),status:i.status==="canceled"||e.status==="canceled"?"canceled":"active",link:e.event_type})}url=r.pagination?.next_page}return out}
async function ghl(){const h={Authorization:`Bearer ${process.env.OPKIE_GHL_TOKEN}`,Version:"2021-04-15",Accept:"application/json"};
 const q=new URLSearchParams({locationId:"vmzEamyXqsd9g2bEFYGu",calendarId:"BRL34eYzQ16BNOIiLz3F",startTime:String(Date.parse("2026-09-01")),endTime:String(Date.parse("2027-02-01"))});
 const r=await (await fetch(`https://services.leadconnectorhq.com/calendars/events?${q}`,{headers:h})).json();
 if(!r.events){console.log("GHL",JSON.stringify(r).slice(0,300));return[]}
 return r.events.filter(e=>inOct((e.dateAdded||"").slice(0,10))).map(e=>({booked:e.dateAdded.slice(0,10),meet:e.startTime.slice(0,10),name:e.title,email:(e.appointmentMeta?.defaultFormDetails?.email||"").toLowerCase(),status:e.appointmentStatus,link:""}))}
async function at(b){const u=new URL(`https://api.airtable.com/v0/${b}/tblTnxArHDVMNOxSI`);u.searchParams.set("filterByFormula","AND(IS_AFTER({Meeting booked date},'2026-09-30'),IS_BEFORE({Meeting booked date},'2026-11-01'))");return ((await (await fetch(u,{headers:A})).json()).records||[]).map(r=>r.fields.Email?.toLowerCase())}
async function outreach(slug,email){const d=email.split("@")[1];const free=["gmail.com","yahoo.com","hotmail.com","outlook.com","icloud.com"].includes(d);
 const r=(await p.query(`select lead_name,lead_company from replies where workspace_slug=$1 and (lower(lead_email)=$2 or lower(preferred_recipient_email)=$2 ${free?"":"or lower(lead_email) like $3"}) limit 1`,free?[slug,email]:[slug,email,"%@"+d])).rows[0];
 const s=(await p.query(`select count(*) n from emails_sent where workspace_slug=$1 and (lower(lead_email)=$2 ${free?"":"or lower(lead_email) like $3"})`,free?[slug,email]:[slug,email,"%@"+d])).rows[0].n;
 return {match:!!r||s>0,company:r?.lead_company||"",dbname:r?.lead_name||""}}
const clients=[["CLPR Media","clpr-media","applnvVcAGLchrG2b",()=>cal(process.env.CLPR_MEDIA_CALENDLY_TOKEN)],["MP Consulting","mp-consulting","apphW2yI5MyGDOLs9",()=>cal(process.env.MP_CONSULTING_CALENDLY_TOKEN)],["Opkie","opkie","app7LXrt82RJynd1B",ghl],["Cheap Assist","cheap-assist","appkX7wBB1wOXrs1s",async()=>[]]];
for(const [label,slug,base,src] of clients){const b=await src();const air=await at(base);console.log("##",label,"| airtable Oct:",JSON.stringify(air));
 for(const x of b){const o=x.email?await outreach(slug,x.email):{};console.log([x.booked,x.meet,x.status,x.name,x.email,o.company,"outreach:"+o.match,"inAirtable:"+air.includes(x.email),x.link.split("/").pop()].join(" | "))}}
await p.end();

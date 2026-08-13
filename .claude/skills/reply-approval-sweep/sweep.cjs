// Reply Approval Sweep — STEP 4: send, with ALL GUARDS. Static: never edit.
// Reads WORK/pulled.json + WORK/decisions.js ({rewrites, skip, manual}).
// GUARDS (every card, before any send):
//   1. we-already-replied (DB): MAX(our sent_at, lead+pref) > MAX(their received_at) -> skip
//   2. Peter in thread (barsoom|pbarsoom|nukafoods|1906newhighs) -> skip
//   3. live EmailBison "we spoke last" (latest msg folder=Sent) -> skip
//   4. duplicate body (exact normalized body already sent in 30d) -> skip
//   FLAG: fabricated day-times / retired-or-wrong links / angle-bracket links -> NOT sent
//   bannedFig: banned case studies (Motel Margarita/KyiKyi/Headwaters + banned figures) -> NOT sent
const path=require('path'), fs=require('fs');
const ROOT=path.resolve(__dirname,'../../..');
const WORK=process.env.RAS_WORKDIR || '/tmp/reply-approval-sweep';
const env=fs.readFileSync(path.join(ROOT,'.env.local'),'utf8');
const g=k=>{const m=env.match(new RegExp('^'+k+'=(.*)$','m'));return m?m[1].trim().replace(/^['"]|['"]$/g,''):null;};
const pg=require(path.join(ROOT,'node_modules','pg'));
const {verifySlot}=require('./calendly-verify.cjs');
const DBURL=g('DATABASE_URL'), TOKEN=g('SLACK_BOT_TOKEN');
const APP=process.env.REPLY_APPROVAL_CHANNEL || 'C0B183MQLKY';   // #reply-approval
const MAN=process.env.MANUAL_REPLIES_CHANNEL || 'C0B0MMMMNKZ';   // #manual-replies
const decPath=path.join(WORK,'decisions.js');
if(!fs.existsSync(decPath)){console.error('MISSING '+decPath+'\nReview the cards, then write decisions.js:\n  module.exports={ rewrites:{"email":`body`}, skip:["email"], manual:{"email":"reason"} };');process.exit(1);}
const D=require(decPath);
const rewrites=D.rewrites||{}, skipEyesOnly=new Set(D.skip||[]), manualRoute=D.manual||{};
const pool=new pg.Pool({connectionString:DBURL,ssl:false,max:3});
const slack=async(m,p)=>{const r=await fetch('https://slack.com/api/'+m,{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(p)});return r.json();};
const eyes=ts=>slack('reactions.add',{channel:APP,timestamp:ts,name:'eyes'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=b=>b.replace(/<((?:https?|mailto):[^|>\s]+)\|[^>]*>/g,'$1').replace(/<((?:https?|mailto):[^|>\s]+)>/g,'$1').replace(/calendly\.com\/lukasmaxen\//g,'calendly.com/lukasm-acceler8rs/');
const linkify=t=>t.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1">$1</a>');
const toHtml=b=>norm(b).split('\n\n').map(p=>`<p style="margin:0 0 16px 0;">${linkify(p.replace(/\n/g,'<br>'))}</p>`).join('');
const bannedFig=t=>/25k[^.]{0,15}102k|102k[^.]{0,20}90\s*days|13k[^.]{0,15}140k|140k[^.]{0,20}60\s*days|headwaters|kyikyi|motel margarita/i.test(t||'');
async function weSpokeLast(iu,ak,leadEmail){if(!iu||!ak||!leadEmail)return false;try{const r=await fetch(`${iu}/api/replies?per_page=50&search=${encodeURIComponent(leadEmail)}`,{headers:{Authorization:`Bearer ${ak}`,Accept:'application/json'}});if(!r.ok)return false;const items=(await r.json())?.data??[];if(!items.length)return false;let latest=items[0],ms=-Infinity;for(const it of items){const t=new Date(it.date_received||it.date_sent||0).getTime();if(t>=ms){ms=t;latest=it;}}return latest&&latest.folder==='Sent';}catch{return false;}}
const normDedup=b=>(b||'').replace(/\{SENDER_EMAIL_SIGNATURE\}/gi,'').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim().toLowerCase();
async function alreadySentBody(leadEmail,body){const target=normDedup(body);if(!leadEmail||target.length<15)return false;try{const rows=await pool.query(`SELECT body FROM sent_emails WHERE lead_email=$1 AND sent_at > NOW() - INTERVAL '30 days' ORDER BY sent_at DESC LIMIT 25`,[leadEmail]);return rows.rows.some(r=>normDedup(r.body)===target);}catch{return false;}}
const PETER=/barsoom|pbarsoom|nukafoods|1906newhighs/i;
(async()=>{
const cards=JSON.parse(fs.readFileSync(path.join(WORK,'pulled.json'),'utf8')).filter(c=>c.status==='pending');
let sent=0,rew=0,man=0,skip=0,fail=0;
for(const c of cards){
  const email=(c.lead_email||'').toLowerCase();
  // GUARD 1: we already replied (DB timestamp, lead + pref)
  {const pf=(c.preferred_recipient_email||email).toLowerCase();
   const ls=await pool.query('SELECT MAX(sent_at) mx FROM sent_emails WHERE lead_email ILIKE $1 OR lead_email ILIKE $2',[email,pf]);
   const lr=await pool.query('SELECT MAX(received_at) mx FROM replies WHERE lead_email ILIKE $1 OR preferred_recipient_email ILIKE $1 OR lead_email ILIKE $2 OR preferred_recipient_email ILIKE $2',[email,pf]);
   if(ls.rows[0].mx && lr.rows[0].mx && new Date(ls.rows[0].mx)>new Date(lr.rows[0].mx)){await eyes(c.ts);await pool.query(`UPDATE reply_drafts SET status='skipped', reviewed_at=NOW(), reviewed_by='Claude MCP' WHERE slack_ts=$1`,[c.ts]);skip++;console.log('SKIP (we already replied) '+email);await sleep(120);continue;}}
  if(skipEyesOnly.has(email)){await eyes(c.ts);await pool.query(`UPDATE reply_drafts SET status='skipped', reviewed_at=NOW(), reviewed_by='Claude MCP' WHERE slack_ts=$1`,[c.ts]);skip++;console.log('SKIP (manual decision) '+email);await sleep(150);continue;}
  // GUARD 2: Peter in thread
  {const blob=[c.message,...(c.thread_replies||[]).map(r=>r.message),...(c.thread_sent||[]).map(s=>s.body)].join(' ');
   if(PETER.test(blob)){await eyes(c.ts);await pool.query(`UPDATE reply_drafts SET status='skipped', reviewed_at=NOW(), reviewed_by='Claude MCP' WHERE slack_ts=$1`,[c.ts]);skip++;console.log('SKIP (Peter in thread) '+email);await sleep(150);continue;}}
  if(manualRoute[email]){await slack('chat.postMessage',{channel:MAN,text:`:handshake: *Needs manual action*\n${manualRoute[email]}\nLead: ${c.lead_name} <${email}> | ${c.lead_company||''}\nEB reply: ${c.email_bison_reply_id}`});await eyes(c.ts);await pool.query(`UPDATE reply_drafts SET status='manual', reviewed_at=NOW(), reviewed_by='Claude MCP' WHERE slack_ts=$1`,[c.ts]);man++;console.log('-> MANUAL '+email);await sleep(300);continue;}
  const rw=rewrites[email];
  const rwIsObj=rw&&typeof rw==='object';
  let body=norm(rwIsObj?rw.body:(rw||c.body));
  const proposedSlots=rwIsObj&&Array.isArray(rw.slots)?rw.slots:[];
  const isRew=!!rw;
  if(bannedFig(body)){console.log('BLOCKED banned figure/name',email);fail++;continue;}
  if(/<https?:\/\//.test(body)||/https?:\/\/[^\s]*>/.test(body)||/lukasmaxen\/|larsen-digital-marketing\/intro|would.*work\?|either of these/i.test(body)){console.log('!! FLAG, NOT sending',email,'::',body.replace(/\n/g,' ').slice(0,80));fail++;continue;}
  // Specific day+time phrasing is only allowed when decisions.js supplied `slots` for this
  // card AND every one of those slots re-verifies as a REAL, currently-available, in-window
  // (08:00-20:00 local) Calendly slot at send time. Fabricated/stale times still get blocked.
  if(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(body)&&/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(body)){
    if(!proposedSlots.length){console.log('!! FLAG, NOT sending (time phrase, no verified slots supplied)',email);fail++;continue;}
    let allVerified=true;
    for(const s of proposedSlots){
      const ok=await verifySlot(c.workspace_slug,s.iso,s.tz,!!s.wantMA);
      if(!ok){console.log('!! FLAG, NOT sending (slot failed live re-verification)',email,s.iso);allVerified=false;break;}
    }
    if(!allVerified){fail++;continue;}
    console.log('   verified',proposedSlots.length,'live slot(s) for',email);
  }
  const q=await pool.query(`SELECT r.email_bison_reply_id, r.sender_email_id, r.lead_name, r.lead_email, r.subject, r.preferred_recipient_email, r.preferred_recipient_name, r.workspace_slug, w.email_bison_api_key, w.email_bison_instance_url FROM replies r JOIN workspaces w ON w.slug=r.workspace_slug WHERE r.id=$1`,[c.reply_id]);
  const d=q.rows[0];
  const recip=d.preferred_recipient_email||d.lead_email; const recipName=d.preferred_recipient_name||d.lead_name;
  // GUARD 3: live EmailBison we-spoke-last
  if(await weSpokeLast(d.email_bison_instance_url,d.email_bison_api_key,d.lead_email)){await eyes(c.ts);await pool.query(`UPDATE reply_drafts SET status='skipped', reviewed_at=NOW(), reviewed_by='Claude MCP' WHERE slack_ts=$1`,[c.ts]);skip++;console.log('SKIP (we spoke last) '+email);await sleep(200);continue;}
  // GUARD 4: duplicate body already sent
  if(await alreadySentBody(d.lead_email,body)){await eyes(c.ts);await pool.query(`UPDATE reply_drafts SET status='skipped', reviewed_at=NOW(), reviewed_by='Claude MCP' WHERE slack_ts=$1`,[c.ts]);skip++;console.log('SKIP (duplicate body) '+email);await sleep(200);continue;}
  const payload={message:toHtml(body),sender_email_id:d.sender_email_id,to_emails:[{name:recipName,email_address:recip}],inject_previous_email_body:true,content_type:'html'};
  const res=await fetch(`${d.email_bison_instance_url}/api/replies/${d.email_bison_reply_id}/reply`,{method:'POST',headers:{Authorization:`Bearer ${d.email_bison_api_key}`,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});
  if(res.ok){
    await pool.query(`INSERT INTO sent_emails (id,reply_id,workspace_slug,lead_email,lead_name,email_type,subject,body,sent_at) VALUES ($1,$2,$3,$4,$5,'auto_reply',$6,$7,NOW())`,[`auto-${c.reply_id}-${Date.now()}`,c.reply_id,d.workspace_slug,recip,recipName,d.subject||'',body]);
    await pool.query(`UPDATE replies SET status='replied', interested=$1, ai_analyzed_at=NOW() WHERE id=$2`,[['interested','interested_urgent'].includes(c.intent)?true:null,c.reply_id]);
    await pool.query(`UPDATE reply_drafts SET body=$1, status='sent', sent_at=NOW(), reviewed_at=NOW(), reviewed_by='Claude MCP' WHERE slack_ts=$2`,[body,c.ts]);
    await eyes(c.ts); sent++; if(isRew)rew++; console.log((isRew?'REWROTE+SENT ':'SENT ')+email+' -> '+recip);
  } else {fail++; console.log('EB FAIL',email,res.status,(await res.text()).slice(0,120));}
  await sleep(380);
}
console.log(`\nDONE: sent ${sent} (rewrites ${rew}) | manual ${man} | skipped ${skip} | failed ${fail}`);
await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

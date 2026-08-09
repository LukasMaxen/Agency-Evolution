// Reply Approval Sweep — STEP 1: pull unhandled #reply-approval cards.
// Writes WORK/pulled.json and prints the pending list. Static: never edit.
const path=require('path'), fs=require('fs');
const ROOT=path.resolve(__dirname,'../../..');                 // project root
const WORK=process.env.RAS_WORKDIR || '/tmp/reply-approval-sweep';
fs.mkdirSync(WORK,{recursive:true});
const env=fs.readFileSync(path.join(ROOT,'.env.local'),'utf8');
const g=k=>{const m=env.match(new RegExp('^'+k+'=(.*)$','m'));return m?m[1].trim().replace(/^['"]|['"]$/g,''):null;};
const pg=require(path.join(ROOT,'node_modules','pg'));
const DBURL=g('DATABASE_URL'), TOKEN=g('SLACK_BOT_TOKEN');
const CH=process.env.REPLY_APPROVAL_CHANNEL || 'C0B183MQLKY';  // #reply-approval
const pool=new pg.Pool({connectionString:DBURL,ssl:false,max:4});
const slack=async(m,p)=>{const r=await fetch('https://slack.com/api/'+m,{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(p)});return r.json();};
(async()=>{
  console.log('WORKDIR:',WORK,'(write decisions.js here)');
  const oldest=String(Math.floor((Date.now()-5*24*3600*1000)/1000));
  let cur,msgs=[];
  do{const r=await slack('conversations.history',{channel:CH,oldest,limit:200,cursor:cur});if(!r.ok){console.log('slack err',r.error);break;}msgs=msgs.concat(r.messages||[]);cur=r.has_more&&r.response_metadata&&r.response_metadata.next_cursor;}while(cur);
  const un=msgs.filter(m=>!m.reactions);
  console.log('cards last 5d:',msgs.length,'| no reaction (unhandled):',un.length);
  const out=[];
  for(const m of un){
    const s=JSON.stringify(m);const mm=s.match(/inbox\\?\/replies\\?\/([a-z0-9-]{8,})/i);const rid=mm?mm[1]:null;
    if(!rid){out.push({ts:m.ts,noid:true,text:(m.text||'').slice(0,200)});continue;}
    const rd=await pool.query(`SELECT rd.reply_id, rd.workspace_slug, rd.body, rd.intent, rd.status, rd.lead_name, rd.lead_email, r.email_bison_reply_id, r.lead_company, r.campaign, r.subject, r.message, r.preferred_recipient_email FROM reply_drafts rd JOIN replies r ON r.id=rd.reply_id WHERE rd.slack_ts=$1 LIMIT 1`,[m.ts]);
    if(!rd.rows.length){out.push({ts:m.ts,missing:true,text:(m.text||'').slice(0,200)});continue;}
    const d=rd.rows[0];
    let tsent=[],trep=[];
    if(d.status==='pending'){
      tsent=(await pool.query(`SELECT sent_at,body FROM sent_emails WHERE workspace_slug=$1 AND lead_email=$2 ORDER BY sent_at`,[d.workspace_slug,d.lead_email])).rows;
      trep=(await pool.query(`SELECT received_at,message FROM replies WHERE workspace_slug=$1 AND lead_email=$2 ORDER BY received_at`,[d.workspace_slug,d.lead_email])).rows;
    }
    out.push({ts:m.ts,...d,thread_sent:tsent,thread_replies:trep});
  }
  fs.writeFileSync(path.join(WORK,'pulled.json'),JSON.stringify(out,null,1));
  const bs={};out.forEach(o=>{const k=o.missing?'missing':o.noid?'noid':o.status;bs[k]=(bs[k]||0)+1;});
  console.log('by status:',JSON.stringify(bs));
  console.log('\nPENDING (need action):');
  out.filter(o=>o.status==='pending').forEach(o=>console.log('  ',new Date(+o.ts*1000).toISOString().slice(0,16),'|',o.workspace_slug,'|',(o.campaign||'').slice(0,30),'|',o.lead_name,'<'+o.lead_email+'>','|',o.intent));
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

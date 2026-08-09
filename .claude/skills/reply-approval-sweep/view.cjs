// Reply Approval Sweep — STEP 2: print each pending card's thread + current draft.
// Reads WORK/pulled.json. Static: never edit.
const path=require('path'), fs=require('fs');
const WORK=process.env.RAS_WORKDIR || '/tmp/reply-approval-sweep';
const rows=JSON.parse(fs.readFileSync(path.join(WORK,'pulled.json'),'utf8')).filter(o=>o.status==='pending');
const QH=/(?:^|\n)[ \t>]*(?:On[\s\S]{0,200}?\bwrote:|-{2,}\s*Original Message\s*-{2,}|_{5,}|From:[ \t]*\S.*\r?\n[ \t]*(?:Sent|Date):[ \t]*\S.*)/i;
const leadNew=t=>{if(!t)return'';const i=t.search(QH);return i>0?t.slice(0,i).trim():t.trim();};
const quoted=t=>{if(!t)return'';const i=t.search(QH);return i>0?t.slice(i).trim():'';};
const clean=t=>(t||'').replace(/\[\/var\/folders[\s\S]*?\]/g,'').replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').trim();
let i=0;
for(const o of rows){
  i++;
  console.log('\n\n========================= #'+i+' =========================');
  console.log(o.workspace_slug+' | '+(o.campaign||'')+' | '+o.intent);
  console.log('LEAD: '+o.lead_name+' <'+o.lead_email+'> | '+(o.lead_company||''));
  console.log('SUBJECT: '+(o.subject||''));
  console.log('slack_ts:'+o.ts+' reply_id:'+o.reply_id+' ebReplyId:'+o.email_bison_reply_id+(o.preferred_recipient_email?' PREF->'+o.preferred_recipient_email:''));
  console.log('\n--- PRIOR EMAILS WE SENT ('+(o.thread_sent||[]).length+') ---');
  (o.thread_sent||[]).forEach(s=>console.log('  ['+String(s.sent_at).slice(0,16)+'] '+clean(s.body).replace(/\n/g,' ').slice(0,320)));
  console.log('\n--- LEAD REPLIES ('+(o.thread_replies||[]).length+') ---');
  (o.thread_replies||[]).forEach(r=>console.log('  ['+String(r.received_at).slice(0,16)+'] '+leadNew(clean(r.message)).replace(/\n/g,' ').slice(0,450)));
  const qc=quoted(clean((o.thread_replies&&o.thread_replies.length?o.thread_replies[o.thread_replies.length-1].message:o.message)||''));
  if(qc) console.log('\n--- QUOTED CHAIN in latest reply ---\n  '+qc.replace(/\n/g,' ').slice(0,600));
  console.log('\n--- CURRENT DRAFT ---');
  console.log(clean(o.body));
}
console.log('\n\nTOTAL pending:',rows.length);

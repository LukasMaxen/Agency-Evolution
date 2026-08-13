// Manual Replies Sweep — STEP 3 (optional): send drafted referral-handover replies
// for cards that need a real reply (e.g. redirect to a colleague/department mailbox)
// rather than a silent delete. Reads WORK/sends.json, an array of:
//   { leadEmail, to, toName, cc, body, ts }
// - leadEmail: the ORIGINAL lead's email, used to look up the DB row (workspace, sender, EB reply id)
// - to / toName: who the reply actually goes to (can differ from leadEmail — a colleague, dept mailbox, etc.)
// - cc: optional array of email strings to CC (almost always the original sender/introducer)
// - body: the drafted reply, with blank lines between paragraphs and {SENDER_EMAIL_SIGNATURE} at the end
// - ts: the Slack message ts to delete once the send succeeds
// Runs the same guards as reply-approval-sweep's sweep.cjs (already-replied, duplicate body)
// before sending, so a stale sends.json can't double-email someone. Static: never edit.
const path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, "../../..");
const WORK = process.env.MRS_WORKDIR || "/tmp/manual-replies-sweep";
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null; };
const pg = require(path.join(ROOT, "node_modules", "pg"));
const { verifySlot } = require("../reply-approval-sweep/calendly-verify.cjs");
const bannedFig = (t) => /25k[^.]{0,15}102k|102k[^.]{0,20}90\s*days|13k[^.]{0,15}140k|140k[^.]{0,20}60\s*days|headwaters|kyikyi|motel margarita/i.test(t || "");
const DBURL = g("DATABASE_URL"), TOKEN = g("SLACK_BOT_TOKEN");
const CH = process.env.MANUAL_REPLIES_CHANNEL_ID || "C0B0MMMMNKZ";
const pool = new pg.Pool({ connectionString: DBURL, ssl: false, max: 3 });
const slack = async (m, p) => { const r = await fetch("https://slack.com/api/" + m, { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(p) }); return r.json(); };
const norm = (b) => b.replace(/<((?:https?|mailto):[^|>\s]+)\|[^>]*>/g, "$1").replace(/<((?:https?|mailto):[^|>\s]+)>/g, "$1");
const linkify = (t) => t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
const toHtml = (b) => norm(b).split("\n\n").map((p) => `<p style="margin:0 0 16px 0;">${linkify(p.replace(/\n/g, "<br>"))}</p>`).join("");
const normDedup = (b) => (b || "").replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().toLowerCase();

(async () => {
  const jobs = JSON.parse(fs.readFileSync(path.join(WORK, "sends.json"), "utf8"));
  for (const job of jobs) {
    const q = await pool.query(
      `SELECT r.id, r.email_bison_reply_id, r.sender_email_id, r.subject, r.workspace_slug, w.email_bison_api_key, w.email_bison_instance_url
       FROM replies r JOIN workspaces w ON w.slug = r.workspace_slug
       WHERE r.lead_email ILIKE $1 ORDER BY r.received_at DESC LIMIT 1`, [job.leadEmail]
    );
    const d = q.rows[0];
    if (!d) { console.log("NO DB ROW for", job.leadEmail); continue; }

    if (bannedFig(job.body)) { console.log("BLOCKED banned figure/name", job.leadEmail); continue; }
    if (/Monday at|Tuesday at|Wednesday at|Thursday at|Friday at|Saturday at|Sunday at/i.test(job.body)) {
      const slots = Array.isArray(job.slots) ? job.slots : [];
      if (!slots.length) { console.log("BLOCKED (time phrase, no verified slots supplied)", job.leadEmail); continue; }
      let allOk = true;
      for (const s of slots) {
        const ok = await verifySlot(d.workspace_slug, s.iso, s.tz, !!s.wantMA);
        if (!ok) { console.log("BLOCKED (slot failed live re-verification)", job.leadEmail, s.iso); allOk = false; break; }
      }
      if (!allOk) continue;
      console.log("  verified", slots.length, "live slot(s) for", job.leadEmail);
    }

    // guard: already replied (DB) — check both leadEmail and the new `to` address
    const ls = await pool.query("SELECT MAX(sent_at) mx FROM sent_emails WHERE lead_email ILIKE $1 OR lead_email ILIKE $2", [job.leadEmail, job.to]);
    const lr = await pool.query("SELECT MAX(received_at) mx FROM replies WHERE lead_email ILIKE $1 OR lead_email ILIKE $2", [job.leadEmail, job.to]);
    if (ls.rows[0].mx && lr.rows[0].mx && new Date(ls.rows[0].mx) > new Date(lr.rows[0].mx)) { console.log("SKIP (already replied)", job.leadEmail); continue; }
    // guard: duplicate body in last 30 days
    const target = normDedup(job.body);
    const dup = await pool.query("SELECT body FROM sent_emails WHERE lead_email ILIKE $1 AND sent_at > NOW() - INTERVAL '30 days'", [job.to]);
    if (target.length > 15 && dup.rows.some((r) => normDedup(r.body) === target)) { console.log("SKIP (duplicate body)", job.leadEmail); continue; }

    const payload = {
      message: toHtml(job.body), sender_email_id: d.sender_email_id,
      to_emails: [{ name: job.toName ?? null, email_address: job.to }],
      ...(job.cc && job.cc.length ? { cc_emails: job.cc.map((e) => ({ name: null, email_address: e })) } : {}),
      inject_previous_email_body: true, content_type: "html",
    };
    const res = await fetch(`${d.email_bison_instance_url}/api/replies/${d.email_bison_reply_id}/reply`, {
      method: "POST", headers: { Authorization: `Bearer ${d.email_bison_api_key}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload),
    });
    if (res.ok) {
      await pool.query(
        `INSERT INTO sent_emails (id,reply_id,workspace_slug,lead_email,lead_name,email_type,subject,body,sent_at) VALUES ($1,$2,$3,$4,$5,'auto_reply',$6,$7,NOW())`,
        [`mrs-${d.id}-${Date.now()}`, d.id, d.workspace_slug, job.to, job.toName ?? null, d.subject ?? "", job.body]
      );
      await pool.query("UPDATE replies SET status='replied' WHERE id=$1", [d.id]);
      if (job.ts) await slack("chat.delete", { channel: CH, ts: job.ts });
      console.log("SENT", job.leadEmail, "->", job.to);
    } else {
      console.log("FAIL", job.leadEmail, res.status, (await res.text()).slice(0, 200));
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  await pool.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

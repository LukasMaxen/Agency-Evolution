// Manual Replies Sweep — STEP 1: pull every unhandled (no-reaction) #manual-replies
// card, resolve its DB row, and gather the FULL thread participant list (lead,
// preferred_recipient_email, AND live EmailBison from/to/cc, not just lead_email —
// CC'd founders/brokers/redirect targets often carry the actual reply). Static: never edit.
const path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, "../../..");
const WORK = process.env.MRS_WORKDIR || "/tmp/manual-replies-sweep";
fs.mkdirSync(WORK, { recursive: true });
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null; };
const pg = require(path.join(ROOT, "node_modules", "pg"));
const DBURL = g("DATABASE_URL"), TOKEN = g("SLACK_BOT_TOKEN");
const CH = process.env.MANUAL_REPLIES_CHANNEL_ID || "C0B0MMMMNKZ"; // #manual-replies
const pool = new pg.Pool({ connectionString: DBURL, ssl: false, max: 5 });
const slack = async (m, p) => { const r = await fetch("https://slack.com/api/" + m, { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(p) }); return r.json(); };
const decode = (s) => (s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const PETER = /barsoom|pbarsoom|nukafoods|1906newhighs/i;

// Pure-noise patterns: CSAT/rating-survey emails and generic bulk OOO with NO named
// redirect contact. These never need a human decision, only OOO-with-a-named-contact
// (a real redirect opportunity) is excluded from this list on purpose.
const NOISE_PATTERNS = [
  /rate your experience/i,
  /csat/i,
  /nysonik\.com/i,
  /how was your experience/i,
];

async function fetchAllAddresses(instanceUrl, apiKey, ebReplyId) {
  if (!instanceUrl || !apiKey || !ebReplyId) return [];
  try {
    const r = await fetch(`${instanceUrl}/api/replies/${ebReplyId}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (!r.ok) return [];
    const data = await r.json();
    const item = data?.data ?? data ?? {};
    const out = [];
    if (typeof item.from_email_address === "string") out.push(item.from_email_address);
    for (const key of ["to_emails", "to", "cc"]) {
      for (const p of item[key] ?? []) {
        const a = p?.address ?? p?.email_address;
        if (typeof a === "string") out.push(a);
      }
    }
    return out.filter((a) => a.includes("@")).map((a) => a.toLowerCase());
  } catch { return []; }
}

(async () => {
  console.log("WORKDIR:", WORK);
  const oldest = String(Math.floor((Date.now() - 30 * 24 * 3600 * 1000) / 1000));
  let cur, msgs = [];
  do {
    const r = await slack("conversations.history", { channel: CH, oldest, limit: 200, ...(cur ? { cursor: cur } : {}) });
    if (!r.ok) { console.log("slack err", r.error); break; }
    msgs = msgs.concat(r.messages || []);
    cur = r.has_more && r.response_metadata && r.response_metadata.next_cursor;
  } while (cur);
  const un = msgs.filter((m) => !m.reactions); // a reaction (from anyone, bot or teammate) = already handled, never touch it

  const out = [];
  for (const m of un) {
    const text = decode(m.text || "");
    const blockText = (m.blocks || []).map((b) => b.type === "header" ? b.text.text : b.type === "section" ? (b.text ? decode(b.text.text) : (b.fields || []).map((f) => decode(f.text)).join(" ")) : "").join(" ");
    const full = text + " " + blockText;
    const isCard = /^:handshake:/.test(text) || (m.blocks || []).some((b) => b.type === "header");
    if (!isCard) { out.push({ ts: m.ts, kind: "not_a_card", text: text.slice(0, 100) }); continue; }

    const linkMatch = full.match(/inbox\/replies\/([a-z0-9-]{8,})/i);
    const rid = linkMatch ? linkMatch[1] : null;
    const ebMatch = full.match(/EB reply:\s*(\d+)/);
    const ebId = ebMatch ? ebMatch[1] : null;
    const leadMatch = full.match(/Lead:\s*([^<]*)<([^>]+)>/);
    const bodyEmail = leadMatch ? leadMatch[2].trim() : null;

    let db = null;
    if (rid) { const r = await pool.query("SELECT id, workspace_slug, lead_email, preferred_recipient_email, email_bison_reply_id, campaign, received_at FROM replies WHERE id=$1", [rid]); db = r.rows[0] || null; }
    else if (ebId) { const r = await pool.query("SELECT id, workspace_slug, lead_email, preferred_recipient_email, email_bison_reply_id, campaign, received_at FROM replies WHERE email_bison_reply_id=$1 ORDER BY received_at DESC LIMIT 1", [ebId]); db = r.rows[0] || null; }

    const email = (db && db.lead_email) || bodyEmail;
    if (!email) { out.push({ ts: m.ts, kind: "unresolved", text: full.slice(0, 150) }); continue; }

    const addrs = new Set([email.toLowerCase()]);
    if (db && db.preferred_recipient_email) addrs.add(db.preferred_recipient_email.toLowerCase());
    let workspaceSlug = db ? db.workspace_slug : null;
    if (db) {
      const w = await pool.query("SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug=$1", [db.workspace_slug]);
      if (w.rows[0]) {
        const live = await fetchAllAddresses(w.rows[0].email_bison_instance_url, w.rows[0].email_bison_api_key, db.email_bison_reply_id);
        live.forEach((a) => addrs.add(a));
      }
    }
    // drop our own sending addresses (rough domain filter, good enough to avoid self-matching)
    const OWN_DOMAINS = ["gnmotiongrowth", "larsendigital", "acceleratorsco", "actcapitaladvisors", "agencyevolution", "hiaccelerators", "acceleratorsone", "acceleratorsllc", "meetaccelerators"];
    const addrList = Array.from(addrs).filter((a) => !OWN_DOMAINS.some((d) => a.includes(d)));

    let maxSent = null, maxRecv = null;
    for (const a of addrList) {
      const se = await pool.query("SELECT MAX(sent_at) mx FROM sent_emails WHERE lead_email ILIKE $1", [a]);
      const re = await pool.query("SELECT MAX(received_at) mx FROM replies WHERE lead_email ILIKE $1 OR preferred_recipient_email ILIKE $1", [a]);
      if (se.rows[0].mx && (!maxSent || new Date(se.rows[0].mx) > new Date(maxSent))) maxSent = se.rows[0].mx;
      if (re.rows[0].mx && (!maxRecv || new Date(re.rows[0].mx) > new Date(maxRecv))) maxRecv = re.rows[0].mx;
    }
    const alreadyResponded = !!(maxSent && maxRecv && new Date(maxSent) > new Date(maxRecv));
    const isPeter = PETER.test(full);
    const isNoise = NOISE_PATTERNS.some((p) => p.test(full)) && !isCard === false; // pure CSAT/survey, never a real reply
    const calls = addrList.length ? (await pool.query("SELECT status FROM calls WHERE lead_email = ANY($1) AND status NOT IN ('cancelled') LIMIT 1", [addrList])).rows : [];

    // Superseded: the lead themselves sent a LATER message (any address in this
    // thread) that already reads as not_interested/unsubscribe/hard_no. The open
    // question this card raised (pricing, ICP fit, whatever) is moot, they walked
    // away after asking it. Don't hold it open waiting on a decision nobody needs anymore.
    let supersededByDecline = false;
    if (addrList.length) {
      const later = await pool.query(
        `SELECT ai_analysis->>'intent' AS intent, received_at FROM replies
         WHERE lead_email = ANY($1) AND received_at > COALESCE($2, 'epoch'::timestamptz)
         ORDER BY received_at DESC LIMIT 1`,
        [addrList, db ? db.received_at : null]
      );
      const intent = later.rows[0]?.intent;
      if (intent && ["not_interested", "unsubscribe", "hard_no", "wrong_target"].includes(intent)) supersededByDecline = true;
    }

    const ageDays = Math.floor((Date.now() - Number(m.ts) * 1000) / 86400000);

    out.push({
      ts: m.ts, kind: "card", rid, ebId, email, workspaceSlug, addrs: addrList,
      maxSent, maxRecv, alreadyResponded, isPeter, isNoise, meetingScheduled: calls.length > 0,
      supersededByDecline, ageDays, text: full.slice(0, 500),
    });
    await new Promise((r) => setTimeout(r, 120));
  }

  fs.writeFileSync(path.join(WORK, "pulled.json"), JSON.stringify(out, null, 1));
  const cards = out.filter((o) => o.kind === "card");
  const autoDelete = cards.filter((o) => o.alreadyResponded || o.isPeter || o.isNoise || o.meetingScheduled || o.supersededByDecline);
  const needsReview = cards.filter((o) => !autoDelete.includes(o));

  console.log(`\ncards: ${cards.length} | auto-delete candidates: ${autoDelete.length} | needs human review: ${needsReview.length} | non-card chat: ${out.filter(o=>o.kind==="not_a_card").length}`);
  console.log("\n--- AUTO-DELETE (already responded / Peter / pure noise / meeting booked / lead later declined) ---");
  autoDelete.forEach((o) => console.log(" ", o.email, "| reason:", o.alreadyResponded ? "already responded" : o.isPeter ? "Peter" : o.meetingScheduled ? "meeting scheduled" : o.supersededByDecline ? "lead later declined" : "noise/CSAT"));
  console.log("\n--- NEEDS REVIEW (real open questions/decisions, do not delete blindly) ---");
  needsReview.sort((a, b) => b.ageDays - a.ageDays).forEach((o) => console.log(" ", o.ageDays >= 7 ? `[STALE ${o.ageDays}d]` : `[${o.ageDays}d]`, o.email, "|", o.text.replace(/\n/g, " ").slice(0, 130)));
  await pool.end();
})().catch((e) => { console.error("ERR", e.message, e.stack); process.exit(1); });

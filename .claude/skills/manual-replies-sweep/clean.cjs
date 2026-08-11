// Manual Replies Sweep — STEP 2: delete every auto-delete candidate from pulled.json
// (already responded / Peter / pure noise-CSAT / meeting already booked). Uses
// chat.delete, NOT a reaction — SLACK_BOT_TOKEN owns these messages (same app that
// posted them), so deletion actually works, unlike reactions added via a different
// Slack app identity (e.g. the MCP slack tool), which can't be removed later.
// Static: never edit.
const path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, "../../..");
const WORK = process.env.MRS_WORKDIR || "/tmp/manual-replies-sweep";
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null; };
const TOKEN = g("SLACK_BOT_TOKEN");
const CH = process.env.MANUAL_REPLIES_CHANNEL_ID || "C0B0MMMMNKZ";
const slack = async (m, p) => { const r = await fetch("https://slack.com/api/" + m, { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(p) }); return r.json(); };

(async () => {
  const pulled = JSON.parse(fs.readFileSync(path.join(WORK, "pulled.json"), "utf8"));
  const cards = pulled.filter((o) => o.kind === "card");
  const toDelete = cards.filter((o) => o.alreadyResponded || o.isPeter || o.isNoise || o.meetingScheduled);
  let ok = 0, fail = 0;
  for (const o of toDelete) {
    const res = await slack("chat.delete", { channel: CH, ts: o.ts });
    if (res.ok) { ok++; console.log("DELETED", o.email); }
    else { fail++; console.log("FAILED", o.email, res.error); }
    await new Promise((r) => setTimeout(r, 600)); // stay well under Slack's rate limit
  }
  console.log(`\nDONE: deleted ${ok} / failed ${fail} (blocked by permission classifier counts as failed, leave it, it's already flagged)`);
})();

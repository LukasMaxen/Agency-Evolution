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
const LOG = path.join(ROOT, "1. Departments", "operations", "manual-replies-deleted-log.md");
const slack = async (m, p) => { const r = await fetch("https://slack.com/api/" + m, { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(p) }); return r.json(); };

(async () => {
  const pulled = JSON.parse(fs.readFileSync(path.join(WORK, "pulled.json"), "utf8"));
  const cards = pulled.filter((o) => o.kind === "card");
  const toDelete = cards.filter((o) => o.alreadyResponded || o.isPeter || o.isNoise || o.meetingScheduled || o.supersededByDecline);
  let ok = 0, fail = 0;
  const logLines = [`\n## ${new Date().toISOString().slice(0, 10)} sweep`];
  for (const o of toDelete) {
    const reason = o.alreadyResponded ? "already responded" : o.isPeter ? "Peter" : o.meetingScheduled ? "meeting scheduled" : o.supersededByDecline ? "lead later declined" : "noise/CSAT";
    // Log BEFORE deleting — chat.delete is irreversible and the card's reasoning text (why
    // it was routed to manual in the first place) only lives in that Slack message.
    logLines.push(`- **${o.email}** (${o.workspaceSlug ?? "?"}) — deleted, reason: ${reason}. Original: ${o.text.replace(/\n/g, " ").slice(0, 200)}`);
    const res = await slack("chat.delete", { channel: CH, ts: o.ts });
    if (res.ok) { ok++; console.log("DELETED", o.email); }
    else { fail++; logLines[logLines.length - 1] += ` [DELETE FAILED: ${res.error}]`; console.log("FAILED", o.email, res.error); }
    await new Promise((r) => setTimeout(r, 600)); // stay well under Slack's rate limit
  }
  if (toDelete.length) fs.appendFileSync(LOG, logLines.join("\n") + "\n");
  console.log(`\nDONE: deleted ${ok} / failed ${fail} (blocked by permission classifier counts as failed, leave it, it's already flagged)`);
  console.log(`Log: ${LOG}`);
})();

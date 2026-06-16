/**
 * Test the hahnbeck forward-to-client flow on one historical interested reply
 * (Ric Hoke at WAVS Custom). Defaults to DRY-RUN, only logs what would be sent.
 * Pass --send to actually call the EmailBison API and forward to th@hahnbeck.com.
 *
 * Run with:
 *   npx tsx scripts/test-forward-hahnbeck.ts            # dry run
 *   npx tsx scripts/test-forward-hahnbeck.ts --send     # live forward
 */
import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const REPLY_ID = "a1ad5284-4caa-450f-b600-a4f520e66eaf"; // Ric, WAVS Custom, hahnbeck
const FORWARD_TO = "th@hahnbeck.com";
const INTENT = "interested";
const SEND = process.argv.includes("--send");

async function main() {
  const r = await pool.query(
    `SELECT r.*, w.email_bison_api_key, w.email_bison_instance_url
     FROM replies r JOIN workspaces w ON w.slug = r.workspace_slug
     WHERE r.id = $1`,
    [REPLY_ID]
  );
  if (r.rows.length === 0) {
    console.error("[test] reply not found");
    process.exit(1);
  }
  const reply = r.rows[0];

  console.log("[test] reply:", {
    id: reply.id,
    workspace: reply.workspace_slug,
    lead: `${reply.lead_name} <${reply.lead_email}>`,
    company: reply.lead_company,
    subject: reply.subject,
    email_bison_reply_id: reply.email_bison_reply_id,
    sender_email_id: reply.sender_email_id,
    instance_url: reply.email_bison_instance_url,
  });

  const ebLink = `${reply.email_bison_instance_url}/inbox/replies/${reply.id}`;
  const leadLine = [reply.lead_name, reply.lead_company].filter(Boolean).join(" at ") || reply.lead_email;
  const intentLabel = INTENT.replace(/_/g, " ");

  const body = `FYI, new ${intentLabel} reply from ${leadLine}.

Open in EmailBison to read the full thread and respond.

${ebLink}`;

  console.log("\n[test] would forward to:", FORWARD_TO);
  console.log("[test] body that will be sent:\n");
  console.log(body);
  console.log("");

  if (!SEND) {
    console.log("[test] DRY RUN, not calling EmailBison. Pass --send to actually forward.");
    await pool.end();
    return;
  }

  if (!reply.email_bison_reply_id || !reply.sender_email_id) {
    console.error("[test] missing email_bison_reply_id or sender_email_id, cannot send");
    await pool.end();
    process.exit(1);
  }

  const linkify = (text: string) =>
    text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');

  const htmlBody = body
    .split("\n\n")
    .map(para => `<p style="margin:0 0 16px 0;">${linkify(para.replace(/\n/g, "<br>"))}</p>`)
    .join("");

  const ebResponse = await fetch(
    `${reply.email_bison_instance_url}/api/replies/${reply.email_bison_reply_id}/reply`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reply.email_bison_api_key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message: htmlBody,
        sender_email_id: reply.sender_email_id,
        to_emails: [{ name: null, email_address: FORWARD_TO }],
        inject_previous_email_body: true,
        content_type: "html",
      }),
    }
  );

  if (!ebResponse.ok) {
    console.error("[test] EmailBison error:", ebResponse.status, await ebResponse.text());
    await pool.end();
    process.exit(1);
  }

  console.log("[test] forward sent successfully");
  await pool.end();
}

main().catch(err => {
  console.error("[test] failed:", err);
  process.exit(1);
});

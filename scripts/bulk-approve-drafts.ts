/**
 * Bulk approve reply drafts from the 2026-05-05 batch.
 * For 4 drafts that need body fixes, updates the body first, then sends all.
 * Run: npx tsx scripts/bulk-approve-drafts.ts
 */

import pool from "../lib/db";
import fs from "fs";
import path from "path";

// ── Body overrides for drafts that need fixes ─────────────────────────────────

const BODY_OVERRIDES: Record<string, string> = {
  // Moses Shmueli — remove $2,000 price mention (violates pricing rule)
  "rd-a1b5089f-4dda-4d4d-8651-5c5793d44815-1777989086481": `Hi Moses,

Appreciate you being direct about that.

That structure does not work for us. Our model is a monthly retainer covering the infrastructure, targeting, and outreach execution. The retainer is what funds the actual work. We do not take finders fees and do not operate on a commission-only basis.

That said, the results speak for themselves. Firms like Hahnbeck and ACT Capital are generating 40 to 50 qualified seller conversations per month on this model, with no long-term commitment.

Worth a quick call to walk through exactly what that looks like in practice?

If so, I have availability Tuesday at 10am CET or Wednesday at 2pm CET. If neither works, feel free to grab a time here: https://calendly.com/lukasmaxen/agency-evolution

{SENDER_EMAIL_SIGNATURE}`,

  // Jason (Venture Exits) — fix "buyers we work with" to specific buyer framing
  "rd-a1b5290b-0476-4d9b-947b-89c3f76d1d70-1777994514471": `Hi Jason,

Appreciate the candor, that context is genuinely helpful.

The buyer we're representing is specifically looking for businesses with proprietary technology and operational differentiation, not just revenue multiples. Advanced manufacturing and multi-technology platforms are exactly the kind of assets they're targeting. It's a capability acquisition, not a financial roll-up.

That said, you're right that fit depends on whether there's real alignment on the vision. A quick call would let me share more about the buyer's strategic criteria and give you a clear sense of whether it's worth going further. I would not want to put you through a lengthy process if the strategic alignment isn't there.

Worth 20 minutes to find out?

If so, I have availability Tuesday at 10am CT or Thursday at 2pm CT. If neither works, feel free to grab a time here: https://calendly.com/tim-ventureexits/30min

{SENDER_EMAIL_SIGNATURE}`,

  // Abigail/Albert (Venture Exits) — fix "we work with businesses open to exploring" to specific buyer framing
  "rd-a1b54085-483e-47f1-b25a-132686ed2944-1777998474870": `Hi Albert,

Abigail passed me along, appreciate the introduction.

We're representing a private equity buyer that expressed specific interest in Texas-founded businesses. Blended Sense came up through that process. The call would simply be to see if there's a strategic fit on both sides, no commitment involved.

Worth a quick 20 minutes?

If so, Tuesday at 10am CT or Wednesday at 2pm CT both work. If neither fits, feel free to grab a time here: https://calendly.com/tim-ventureexits/30min

{SENDER_EMAIL_SIGNATURE}`,

  // Brian Victor — remove [PHONE NUMBER] placeholder, reference signature
  "rd-a1b55cd5-c605-482e-adbd-bcc99704a075-1778003193855": `Hi Brian,

My number is in my signature below. Looking forward to speaking tomorrow.

{SENDER_EMAIL_SIGNATURE}`,
};

// ── Draft IDs to send (from the 2026-05-05 Slack approval batch) ─────────────

const DRAFT_IDS_TO_SEND = [
  "rd-a1b5085f-1f05-4424-863d-ae492765c7d8-1777989077633",   // Dilan / Larsen not_interested
  "rd-a1b5089f-4dda-4d4d-8651-5c5793d44815-1777989086481",   // Moses / Internal interested (body override)
  "rd-a1b50904-2a92-47e1-9308-cad509c98fb6-1777989142463",   // Brittany / 911 interested
  "rd-a1b50a95-32dd-4414-860b-ef660279b344-1777989441320",   // Sebastian / Larsen interested
  "rd-a1b50a9e-b86f-46d2-bf57-dc3b0682e163-1777989451637",   // Molly / Acceler8rs interested
  "rd-a1b50bec-ea8f-4d2b-ae79-850d506f0a1b-1777989617968",   // Karen / GN Motion not_interested
  "rd-a1b50f05-0874-4bf4-95c4-0a4bc0115e4c-1777990162085",   // Duncan / Internal hard_no
  "rd-a1b5144b-889a-4a3b-b1e8-bef7a551a6d5-1777991057676",   // John / Wrobel hard_no
  "rd-a1b51595-9981-44a0-b614-bc0ef8630de5-1777991249881",   // Saddah / Statera needs_info
  "rd-a1b51aa6-7012-4d96-bc93-db4b17196f72-1777992140748",   // Thomas / Wrobel not_interested
  "rd-a1b51c70-d202-4f97-940d-e21c59f50c26-1777992440680",   // Paul Reeves / ACT wrong_target
  "rd-a1b51ddd-1b46-4412-93e0-3332841d1aae-1777992683632",   // Trey Cherry / Internal not_interested
  "rd-a1b51f1b-2c9d-4821-ae56-ea96e6dcd1e9-1777992860628",   // Valerio / Statera not_interested
  "rd-a1b51fbf-8d5a-497d-8c1f-422de3eba497-1777992980780",   // Brian first / ACT not_interested
  "rd-a1b52359-a0ed-4a8f-8a61-505a15e723f1-1777993576420",   // Jamie Kaufman / ACT interested
  "rd-a1b5290b-0476-4d9b-947b-89c3f76d1d70-1777994514471",   // Jason / Venture Exits needs_info (body override)
  "rd-a1b52f37-fdb4-4d5b-8a36-cf05050f19f4-1777995593847",   // Roz / Acceler8rs needs_info
  "rd-a1b5376b-194b-4233-929d-c2081f6dfff7-1777997037119",   // Steven / Internal needs_info
  "rd-a1b54085-483e-47f1-b25a-132686ed2944-1777998474870",   // Abigail-Albert / Venture Exits neutral (body override)
  "rd-a1b54aa5-6662-43e1-883e-89311c13512e-1778000156081",   // Ersin / Statera needs_info
  "rd-a1b54c8f-b54e-4665-b43c-346698b1f6cc-1778000510778",   // Ryan / ACT interested
  "rd-a1b3905f-9de8-4c3c-a074-e069dcf33e12-1778001410000",   // Nate / ACT not_interested
  "rd-a1b5549e-a976-48db-a157-5bc87719f4a1-1778001831984",   // Brian second / ACT interested
  "rd-a1b55784-7b9c-493b-8f2c-8df97579c17b-1778002352868",   // Jeremy / ACT interested
  "rd-a1b559ef-51e6-46ca-ad29-3bbdc93fbaba-1778002716600",   // Jeremy / 911 interested
  "rd-a1b55cd5-c605-482e-adbd-bcc99704a075-1778003193855",   // Brian Victor phone / Internal (body override)
  "rd-a1b55cd5-bfa8-46ce-a329-8e6f9af1b532-1778003197971",   // Brian Victor "That works" / Internal
  "rd-a1b5602a-81b2-44b0-974b-180780611fde-1778003795583",   // Tom Kay / Internal needs_info
  "rd-a1b5629a-728c-4860-85c6-003cc60e70a8-1778004198389",   // Clayton / Larsen interested
];

// ── Send via EmailBison ───────────────────────────────────────────────────────

function linkify(text: string): string {
  return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}

function buildHtml(body: string): string {
  return body
    .split("\n\n")
    .map(para => `<p style="margin:0 0 16px 0;">${linkify(para.replace(/\n/g, "<br>"))}</p>`)
    .join("");
}

async function sendViaEmailBison(
  instanceUrl: string,
  apiKey: string,
  emailBisonReplyId: string,
  senderEmailId: string,
  recipientEmail: string,
  recipientName: string | null,
  body: string
): Promise<boolean> {
  const htmlBody = buildHtml(body);
  const res = await fetch(`${instanceUrl}/api/replies/${emailBisonReplyId}/reply`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      message: htmlBody,
      sender_email_id: senderEmailId,
      to_emails: [{ name: recipientName, email_address: recipientEmail }],
      inject_previous_email_body: true,
      content_type: "html",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`  EmailBison error ${res.status}: ${err.slice(0, 200)}`);
    return false;
  }
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let sent = 0, failed = 0, skipped = 0;

  for (const draftId of DRAFT_IDS_TO_SEND) {
    // Step 1: load draft + reply + workspace creds
    const q = await pool.query(
      `SELECT rd.*, r.email_bison_reply_id, r.sender_email_id,
              r.lead_email, r.lead_name, r.subject,
              r.preferred_recipient_email, r.preferred_recipient_name,
              w.email_bison_api_key, w.email_bison_instance_url
       FROM reply_drafts rd
       JOIN replies r ON r.id = rd.reply_id
       JOIN workspaces w ON w.slug = rd.workspace_slug
       WHERE rd.id = $1 AND rd.status = 'pending'`,
      [draftId]
    );

    if (q.rows.length === 0) {
      console.log(`SKIP ${draftId.slice(0, 40)} — not found or not pending`);
      skipped++;
      continue;
    }

    const d = q.rows[0];

    // Step 2: apply body override if one exists
    const body: string = BODY_OVERRIDES[draftId] ?? d.body;
    if (BODY_OVERRIDES[draftId]) {
      console.log(`  [body override applied] ${d.lead_name}`);
      await pool.query(`UPDATE reply_drafts SET body = $1 WHERE id = $2`, [body, draftId]);
    }

    const recipientEmail = d.preferred_recipient_email || d.lead_email;
    const recipientName  = d.preferred_recipient_name  || d.lead_name || null;

    if (!d.email_bison_reply_id || !d.sender_email_id) {
      console.log(`SKIP ${d.lead_name} — missing EmailBison IDs`);
      skipped++;
      continue;
    }

    // Step 3: send
    process.stdout.write(`SEND ${d.lead_name} (${d.workspace_slug}, ${d.intent}) ... `);
    const ok = await sendViaEmailBison(
      d.email_bison_instance_url,
      d.email_bison_api_key,
      d.email_bison_reply_id,
      d.sender_email_id,
      recipientEmail,
      recipientName,
      body
    );

    if (!ok) {
      console.log("FAILED");
      failed++;
      continue;
    }

    // Step 4: update DB
    const sentId = `bulk-${d.reply_id}-${Date.now()}`;
    await pool.query(
      `INSERT INTO sent_emails (id, reply_id, workspace_slug, lead_email, lead_name, email_type, subject, body, sent_at)
       VALUES ($1,$2,$3,$4,$5,'auto_reply',$6,$7,NOW())`,
      [sentId, d.reply_id, d.workspace_slug, d.lead_email, d.lead_name, d.subject ?? "", body]
    );

    await pool.query(
      `UPDATE replies SET status = 'replied',
        interested = CASE WHEN $1 THEN TRUE ELSE NULL END,
        ai_analyzed_at = NOW()
       WHERE id = $2`,
      [["interested","interested_urgent","needs_info","neutral"].includes(d.intent ?? ""), d.reply_id]
    );

    await pool.query(
      `UPDATE reply_drafts SET status = 'sent', sent_at = NOW(), reviewed_at = NOW(), reviewed_by = 'bulk-approve' WHERE id = $1`,
      [draftId]
    );

    // Step 5: create FU record if needed
    if (d.fu_sequence_type && d.fu_sequence_type !== "none" && !d.flag_meeting_booked && !d.flag_unsubscribe) {
      const totalEmails = d.fu_sequence_type === "abbreviated" ? 2 : 6;
      const fuId = `fu-${d.reply_id}-${Date.now()}`;
      await pool.query(
        `INSERT INTO follow_ups (id, reply_id, workspace_slug, lead_name, lead_email, first_replied_at, fu_step, total_emails, fu_sequence_type, meeting_booked, next_fu_due)
         SELECT $1,$2,$3,$4,$5,NOW(),0,$6,$7,FALSE,NOW() + INTERVAL '2 days'
         WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE reply_id = $2)`,
        [fuId, d.reply_id, d.workspace_slug, d.lead_name, d.lead_email, totalEmails, d.fu_sequence_type]
      );
    }

    console.log("OK");
    sent++;
  }

  console.log(`\nDone. sent=${sent} failed=${failed} skipped=${skipped}`);
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

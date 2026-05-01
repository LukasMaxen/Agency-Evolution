import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { processAutoReply } from "@/app/api/auto-reply/processor";

function extractCleanBody(textBody: string): string {
  if (!textBody) return "";
  const lines = textBody.split("\n");
  const clean: string[] = [];
  for (const line of lines) {
    if (/^On .+ wrote:/.test(line.trim())) break;
    if (line.startsWith(">")) break;
    clean.push(line);
  }
  return clean.join("\n").trim();
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<Record<string, string>> }
) {
  try {
    const { workspace: slug } = await context.params;

    const wsResult = await pool.query(
      "SELECT * FROM workspaces WHERE slug = $1",
      [slug]
    );

    if (wsResult.rows.length === 0) {
      return NextResponse.json(
        { error: `Unknown workspace: ${slug}` },
        { status: 404 }
      );
    }

    const workspace = wsResult.rows[0];
    const body = await req.json();
    const eventType = body?.event?.type ?? "";

    console.log(`[webhook] ${slug} — ${eventType}`);

    // ── LEAD_REPLIED ──────────────────────────────────────────────────────────
    if (eventType === "LEAD_REPLIED") {
      const reply       = body.data.reply;
      const lead        = body.data.lead;
      const campaign    = body.data.campaign;
      const senderEmail = body.data.sender_email;

      const replyUuid       = reply.uuid;
      const leadEmail       = lead.email;
      const leadName        = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || leadEmail;
      const message         = extractCleanBody(reply.text_body ?? "");
      const receivedAt      = reply.date_received ? new Date(reply.date_received) : new Date();

      await pool.query(
  `INSERT INTO replies (
    id, workspace_id, workspace_slug, email_bison_id,
    email_bison_reply_id, email_bison_lead_id,
    lead_email, lead_name, lead_company, lead_title,
    sender_email, sender_email_id,
    to_email, to_name,
    campaign, subject, message,
    received_at, status, interested
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'new',NULL)
  ON CONFLICT (id) DO NOTHING`,
  [
    replyUuid, workspace.id, slug, replyUuid,
    reply.id, lead.id,
    leadEmail, leadName,
    lead.company ?? null, lead.title ?? null,
    senderEmail?.email ?? "", senderEmail?.id ?? null,
    reply.primary_to_email_address ?? leadEmail,
    leadName,
    campaign?.name ?? "",
    reply.email_subject ?? "",
    message, receivedAt,
  ]
);

      await pool.query(
        `INSERT INTO follow_ups (
          id, reply_id, workspace_slug, lead_name, lead_email,
          first_replied_at, fu_step, total_emails, next_fu_due, meeting_booked
        ) VALUES ($1,$2,$3,$4,$5,$6,0,1,$7,false)
        ON CONFLICT (id) DO NOTHING`,
        [
          `fu-${replyUuid}`, replyUuid, slug,
          leadName, leadEmail, receivedAt,
          new Date(receivedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        ]
      );

      await processAutoReply(replyUuid, slug);

      return NextResponse.json({ ok: true, event: "LEAD_REPLIED", id: replyUuid });
    }

    // ── CONTACT_INTERESTED ────────────────────────────────────────────────────
    if (eventType === "CONTACT_INTERESTED") {
      const replyId = body.data?.reply?.uuid;
      if (replyId) {
        await pool.query(
          "UPDATE replies SET interested = TRUE WHERE id = $1",
          [replyId]
        );
      }
      return NextResponse.json({ ok: true, event: "CONTACT_INTERESTED" });
    }

    // ── CONTACT_UNSUBSCRIBED ──────────────────────────────────────────────────
    if (eventType === "CONTACT_UNSUBSCRIBED") {
      const replyId = body.data?.reply?.uuid;
      if (replyId) {
        await pool.query(
          "UPDATE replies SET interested = FALSE, status = 'read' WHERE id = $1",
          [replyId]
        );
      }
      return NextResponse.json({ ok: true, event: "CONTACT_UNSUBSCRIBED" });
    }

    // ── EMAIL_SENT ────────────────────────────────────────────────────────────
    if (eventType === "EMAIL_SENT") {
      const scheduledEmail = body.data?.scheduled_email;
      const lead           = body.data?.lead;
      const campaign       = body.data?.campaign;
      const senderEmail    = body.data?.sender_email;

      const sentId = `sent-${slug}-${scheduledEmail?.id ?? Date.now()}`;

      await pool.query(
        `INSERT INTO emails_sent (
          id, workspace_slug, lead_email, lead_name,
          campaign_name, sender_email, sequence_step, sent_at,
          subject, email_body
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO NOTHING`,
        [
          sentId, slug,
          lead?.email ?? "",
          `${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim(),
          campaign?.name ?? "",
          senderEmail?.email ?? "",
          scheduledEmail?.sequence_step_order ?? null,
          scheduledEmail?.sent_at ? new Date(scheduledEmail.sent_at) : new Date(),
          scheduledEmail?.email_subject ?? null,
          scheduledEmail?.email_body ?? null,
        ]
      );

      return NextResponse.json({ ok: true, event: "EMAIL_SENT" });
    }

    // ── MANUAL_EMAIL_SENT ─────────────────────────────────────────────────────
    if (eventType === "MANUAL_EMAIL_SENT") {
      const reply    = body.data?.reply;
      const lead     = body.data?.lead;
      const campaign = body.data?.campaign;

      const sentId = `manual-${slug}-${reply?.id ?? Date.now()}`;

      await pool.query(
        `INSERT INTO emails_sent (
          id, workspace_slug, lead_email, lead_name,
          campaign_name, sequence_step, sent_at
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT (id) DO NOTHING`,
        [
          sentId, slug,
          lead?.email ?? "",
          `${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim(),
          campaign?.name ?? "",
          null,
        ]
      );

      // Also update follow_up step if this was a follow-up
      if (reply?.uuid) {
        await pool.query(
          `UPDATE follow_ups SET
            last_fu_sent_at = NOW(),
            total_emails = total_emails + 1,
            next_fu_due = NOW() + INTERVAL '7 days'
          WHERE reply_id = $1`,
          [reply.uuid]
        );
      }

      return NextResponse.json({ ok: true, event: "MANUAL_EMAIL_SENT" });
    }

    // ── EMAIL_OPENED ──────────────────────────────────────────────────────────
    if (eventType === "EMAIL_OPENED") {
      const lead     = body.data?.lead;
      const campaign = body.data?.campaign;
      const openId   = `open-${slug}-${lead?.id ?? ""}-${Date.now()}`;

      await pool.query(
        `INSERT INTO email_opens (
          id, workspace_slug, lead_email, lead_name, campaign_name, opened_at
        ) VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (id) DO NOTHING`,
        [
          openId, slug,
          lead?.email ?? "",
          `${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim(),
          campaign?.name ?? "",
        ]
      );

      return NextResponse.json({ ok: true, event: "EMAIL_OPENED" });
    }

    // ── EMAIL_BOUNCED ─────────────────────────────────────────────────────────
    if (eventType === "EMAIL_BOUNCED") {
      const lead     = body.data?.lead;
      const campaign = body.data?.campaign;
      const bounceId = `bounce-${slug}-${lead?.id ?? ""}-${Date.now()}`;

      await pool.query(
        `INSERT INTO email_bounces (
          id, workspace_slug, lead_email, lead_name,
          campaign_name, bounce_type, bounced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT (id) DO NOTHING`,
        [
          bounceId, slug,
          lead?.email ?? "",
          `${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim(),
          campaign?.name ?? "",
          body.data?.bounce_type ?? "unknown",
        ]
      );

      return NextResponse.json({ ok: true, event: "EMAIL_BOUNCED" });
    }

    // ── CONTACT_FIRST_EMAILED ─────────────────────────────────────────────────
    if (eventType === "CONTACT_FIRST_EMAILED") {
      const lead     = body.data?.lead;
      const campaign = body.data?.campaign;
      const sentId   = `first-${slug}-${lead?.id ?? Date.now()}`;

      await pool.query(
        `INSERT INTO emails_sent (
          id, workspace_slug, lead_email, lead_name,
          campaign_name, sequence_step, sent_at
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT (id) DO NOTHING`,
        [
          sentId, slug,
          lead?.email ?? "",
          `${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim(),
          campaign?.name ?? "",
          1,
        ]
      );

      return NextResponse.json({ ok: true, event: "CONTACT_FIRST_EMAILED" });
    }

    // Unknown event
    return NextResponse.json({ ok: true, event: eventType, note: "unhandled" });

  } catch (err: any) {
    console.error("[webhook] error:", err);
    return NextResponse.json(
      { error: err.message ?? "Internal error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "AI Reply Desk webhook" });
}
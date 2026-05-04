import { NextRequest, NextResponse, after } from "next/server";
import pool from "@/lib/db";
import { processAutoReply } from "@/app/api/auto-reply/processor";
import { notifyReply } from "@/lib/slack-notifications";

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

      // If this lead is already in an active FU sequence, record the conversion
      // and stop the sequence — they re-engaged, no more automated FUs needed.
      const activeFu = await pool.query(
        `SELECT id, fu_step FROM follow_ups
         WHERE lead_email = $1 AND workspace_slug = $2
           AND meeting_booked = FALSE AND next_fu_due IS NOT NULL
         LIMIT 1`,
        [leadEmail, slug]
      );
      if (activeFu.rows.length > 0) {
        const fu = activeFu.rows[0];
        await pool.query(
          `UPDATE follow_ups SET
             converted_at_step = $1,
             outcome = 're_engaged',
             next_fu_due = NULL
           WHERE id = $2`,
          [fu.fu_step, fu.id]
        );
      }

      // Schedule the heavy work to run AFTER the webhook response is sent.
      // EmailBison's webhook delivery has a hard timeout, and naked
      // fire-and-forget promises get killed by the Coolify/Next runtime once
      // the response closes. Next 16's `after()` is the supported API for
      // "run this after we've replied to the client" and is guaranteed to
      // complete before the worker shuts down.
      //
      // The follow_ups row for new leads is created inside processAutoReply
      // once intent has been classified.
      after(async () => {
        try {
          await processAutoReply(replyUuid, slug);
        } catch (err: any) {
          console.error(`[webhook] processAutoReply (after) failure for ${replyUuid} (${slug}):`, err);
        }
      });

      // Slack notification to the client's [client]-replies channel.
      // Replaces the Make.com "Email Reply Notifications" scenario for this workspace.
      if (workspace.slack_channel_replies) {
        const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
        const channel = workspace.slack_channel_replies as string;
        const workspaceName = (workspace.name ?? slug) as string;
        after(async () => {
          try {
            await notifyReply({
              channel,
              workspaceName,
              leadName,
              leadEmail,
              leadCompany: lead.company ?? null,
              campaign: campaign?.name ?? "",
              subject: reply.email_subject ?? "",
              message,
              replyUrl: appUrl ? `${appUrl}/replies/${replyUuid}` : undefined,
            });
          } catch (err: any) {
            console.error(`[webhook] notifyReply (after) failure for ${replyUuid} (${slug}):`, err);
          }
        });
      }

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
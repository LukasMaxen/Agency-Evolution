import { NextRequest, NextResponse, after } from "next/server";
import pool from "@/lib/db";
import { processAutoReply } from "@/app/api/auto-reply/processor";
import { notifyReply } from "@/lib/slack-notifications";
import { isOwnSenderAddress } from "@/lib/own-outbound";
import { RAW_REPLY_FEED_CHANNELS } from "@/lib/raw-reply-feed";

function extractCleanBody(textBody: string): string {
  if (!textBody) return "";
  const lines = textBody.split("\n");
  const clean: string[] = [];
  for (const line of lines) {
    if (/^On .+ wrote:/.test(line.trim())) break;
    if (line.startsWith(">")) break;
    clean.push(line);
  }
  const preQuote = clean.join("\n").trim();
  if (preQuote) return preQuote;

  // Lead replied below the quoted thread — extract content after the quote block
  let pastQuote = false;
  const postQuote: string[] = [];
  for (const line of lines) {
    if (!pastQuote) {
      if (/^On .+ wrote:/.test(line.trim()) || line.startsWith(">")) {
        pastQuote = true;
      }
      continue;
    }
    if (!line.startsWith(">")) postQuote.push(line);
  }
  return postQuote.join("\n").trim();
}

function extractQuotedThread(textBody: string): string {
  if (!textBody) return "";
  const lines = textBody.split("\n");
  const quoteStart = lines.findIndex(line =>
    /^On .+ wrote:/.test(line.trim()) || line.trimStart().startsWith(">")
  );
  if (quoteStart === -1) return "";
  return lines.slice(quoteStart).join("\n").trim();
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
      const threadContext   = extractQuotedThread(reply.text_body ?? "") || null;
      const receivedAt      = reply.date_received ? new Date(reply.date_received) : new Date();

      // If the reply was sent FROM a different email than the campaign lead
      // (e.g. Jagoda forwards to Grzegorz who replies from his own address),
      // capture the actual sender so the processor can address and send to them.
      const fromEmail = (reply.from_email_address as string | null) ?? null;
      const fromName  = (reply.from_name as string | null) ?? null;
      const preferredRecipientEmail = fromEmail && fromEmail.toLowerCase() !== leadEmail.toLowerCase() ? fromEmail : null;
      const preferredRecipientName  = preferredRecipientEmail ? (fromName ?? null) : null;

      // LEAD_REPLIED only fires for tracked replies (real responses to campaign
      // sends), so we mark these as tracked unconditionally. Untracked replies
      // land via the inbox-sync poller, which carries the EB-supplied flag.
      const insertResult = await pool.query(
  `INSERT INTO replies (
    id, workspace_id, workspace_slug, email_bison_id,
    email_bison_reply_id, email_bison_lead_id,
    lead_email, lead_name, lead_company, lead_title,
    sender_email, sender_email_id,
    to_email, to_name,
    campaign, subject, message, thread_context,
    received_at, status, interested,
    reply_type, tracked_reply,
    preferred_recipient_email, preferred_recipient_name
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'new',NULL,'Tracked Reply',TRUE,$20,$21)
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
    message, threadContext, receivedAt,
    preferredRecipientEmail, preferredRecipientName,
  ]
);
      const isNewReply = (insertResult.rowCount ?? 0) > 0;

      // ── Own-outbound guard ───────────────────────────────────────────────────
      // If the message was actually authored by one of our own sender accounts,
      // it is our outbound follow-up that EmailBison surfaced as a reply, not a
      // lead reply. Mark it read and stop: no FU conversion, no auto-reply
      // processing, no Slack card. (Catches the "Peter from GN Motion" noise.)
      if (isNewReply && (await isOwnSenderAddress(slug, fromEmail))) {
        await pool.query(
          `UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW(), auto_reply_processed_at = NOW() WHERE id = $2`,
          [JSON.stringify({ intent: "no_action", skipped_reason: "own_outbound_ingested" }), replyUuid]
        );
        console.log(`[webhook] ${slug} — own outbound from ${fromEmail}, marked read (not a lead reply)`);
        return NextResponse.json({ ok: true, event: "LEAD_REPLIED", id: replyUuid, filtered: "own_outbound" });
      }

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

      // Only dispatch the auto-reply processor and Slack notification for new
      // inserts. EmailBison occasionally fires LEAD_REPLIED twice for the same
      // reply — ON CONFLICT DO NOTHING deduplicates the DB row, but without
      // this guard both callbacks would fire twice (duplicate Slack cards).
      if (isNewReply) {
        // Trigger processAutoReply via a self-fetch to /api/auto-reply/run so it
        // executes as its own real HTTP request with full request lifetime, instead
        // of an in-process callback. Prior attempts:
        //   - inline await: EmailBison webhook timed out before Sonnet finished
        //   - fire-and-forget Promise: killed by Coolify when the response closed
        //   - Next 16 after(): worked for ~2 weeks, then started getting silently
        //     dropped (replies stalled at status='new' with no #reply-approval card)
        // The follow_ups row for new leads is still created inside processAutoReply.
        const origin = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
        const runUrl = `${origin}/api/auto-reply/run?id=${encodeURIComponent(replyUuid)}&workspace=${encodeURIComponent(slug)}`;
        fetch(runUrl, {
          method: "POST",
          headers: { "x-internal-token": process.env.AUTO_REPLY_RUN_TOKEN ?? "" },
        }).catch(err => console.error(`[webhook] /run dispatch failed for ${replyUuid} (${slug}):`, err?.message));

        // Slack notification to the client's [client]-replies channel.
        // Replaces the Make.com "Email Reply Notifications" scenario for this workspace.
        const rawFeedChannel = workspace.slack_channel_replies ?? RAW_REPLY_FEED_CHANNELS[slug];
        if (rawFeedChannel) {
          const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
          const channel = rawFeedChannel as string;
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
      const leadEmail = body.data?.lead?.email;
      if (replyId) {
        await pool.query(
          "UPDATE replies SET interested = FALSE, status = 'read', auto_reply_processed_at = COALESCE(auto_reply_processed_at, NOW()) WHERE id = $1",
          [replyId]
        );
      }
      // Kill any active FU sequence for this lead — they have unsubscribed.
      if (leadEmail) {
        await pool.query(
          `UPDATE follow_ups SET next_fu_due = NULL, outcome = 'unsubscribed'
           WHERE workspace_slug = $1 AND lead_email = $2
             AND (outcome IS NULL OR outcome NOT IN ('booked','exhausted','unsubscribed','manually_closed'))`,
          [slug, leadEmail]
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
      const lead        = body.data?.lead;
      const campaign    = body.data?.campaign;
      const senderEmail = body.data?.sender_email;
      const bounceId    = `bounce-${slug}-${lead?.id ?? ""}-${Date.now()}`;

      // Warmup probe bounces have no campaign attached. EB fires EMAIL_BOUNCED
      // for warmup seed address bounces the same as outreach bounces, but we
      // have no business tracking them — they inflate bounce rates and are not
      // real outreach leads. Skip them entirely.
      if (!campaign?.name) {
        return NextResponse.json({ ok: true, event: "EMAIL_BOUNCED", note: "warmup_probe_skipped" });
      }

      // EB's webhook does not send DSN content so we cannot run the full
      // bounce classifier here. Map the coarse bounce_type EB does send to
      // our bounce_category where possible; unrecognised values stay null.
      const ebType = (body.data?.bounce_type ?? "") as string;
      const bounceCategory: string | null =
        ebType === "hard" ? "data_failure" :
        ebType === "soft" ? "soft"         : null;

      await pool.query(
        `INSERT INTO email_bounces (
          id, workspace_slug, lead_email, lead_name,
          campaign_name, sender_email, bounce_type, bounce_category, bounced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (id) DO NOTHING`,
        [
          bounceId, slug,
          lead?.email ?? "",
          `${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim(),
          campaign?.name ?? "",
          senderEmail?.email ?? null,
          ebType || "unknown",
          bounceCategory,
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
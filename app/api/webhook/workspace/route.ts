import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

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

    console.log(`[webhook] ${slug} — event: ${body?.event?.type}`);

    const eventType = body?.event?.type ?? "";

    if (eventType === "LEAD_REPLIED") {
      const reply = body.data.reply;
      const lead = body.data.lead;
      const campaign = body.data.campaign;
      const senderEmail = body.data.sender_email;

      const replyUuid = reply.uuid;
      const leadEmail = lead.email;
      const leadName = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || leadEmail;
      const leadCompany = lead.company ?? null;
      const leadTitle = lead.title ?? null;
      const message = extractCleanBody(reply.text_body ?? "");
      const subject = reply.email_subject ?? "";
      const campaignName = campaign?.name ?? "";
      const senderEmailAddr = senderEmail?.email ?? "";
      const receivedAt = reply.date_received ? new Date(reply.date_received) : new Date();
      const emailBisonReplyId = reply.id;
      const emailBisonLeadId = lead.id;

      await pool.query(
        `INSERT INTO replies (
          id, workspace_id, workspace_slug, email_bison_id,
          email_bison_reply_id, email_bison_lead_id,
          lead_email, lead_name, lead_company, lead_title,
          sender_email, campaign, subject, message,
          received_at, status, interested
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'new',NULL)
        ON CONFLICT (id) DO NOTHING`,
        [
          replyUuid, workspace.id, slug, replyUuid,
          emailBisonReplyId, emailBisonLeadId,
          leadEmail, leadName, leadCompany, leadTitle,
          senderEmailAddr, campaignName, subject, message,
          receivedAt,
        ]
      );

      await pool.query(
        `INSERT INTO follow_ups (
          id, reply_id, workspace_slug, lead_name, lead_email,
          first_replied_at, fu_step, total_emails,
          next_fu_due, meeting_booked
        ) VALUES ($1,$2,$3,$4,$5,$6,0,1,$7,false)
        ON CONFLICT (id) DO NOTHING`,
        [
          `fu-${replyUuid}`, replyUuid, slug,
          leadName, leadEmail,
          receivedAt,
          new Date(receivedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        ]
      );

      return NextResponse.json({ ok: true, event: "LEAD_REPLIED", id: replyUuid });
    }

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
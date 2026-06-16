import { postToSlack, quoteForSlack } from "./slack-approval";

export interface NotifyResult {
  ok: boolean;
  ts: string | null;
}

export interface NotifyReplyOpts {
  channel: string;
  workspaceName: string;
  leadName: string;
  leadEmail: string;
  leadCompany?: string | null;
  campaign: string;
  subject: string;
  message: string;
  replyUrl?: string;
}

/**
 * Post an inbound email reply to the client's Slack channel.
 * Mirrors the Make.com "Email Reply Notifications" scenario, one handler per client.
 * Best-effort: catches and logs any error so the webhook never throws on Slack failure.
 */
export async function notifyReply(opts: NotifyReplyOpts): Promise<NotifyResult> {
  try {
    const company = opts.leadCompany ? ` (${opts.leadCompany})` : "";
    const headline = `New reply from *${opts.leadName}*${company}`;
    const subjectLine = opts.subject ? `*Subject:* ${opts.subject}` : "";
    const campaignLine = opts.campaign ? `*Campaign:* ${opts.campaign}` : "";
    const meta = [campaignLine, subjectLine].filter(Boolean).join("   ·   ");

    const blocks: object[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: headline },
      },
    ];

    if (meta) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: meta }],
      });
    }

    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `${opts.leadEmail} · ${opts.workspaceName}` },
      ],
    });

    if (opts.message) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: quoteForSlack(opts.message, 1500) },
      });
    }

    if (opts.replyUrl) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open in Reply Desk" },
            url: opts.replyUrl,
          },
        ],
      });
    }

    const ts = await postToSlack({
      channel: opts.channel,
      text: `New reply from ${opts.leadName} (${opts.leadEmail})`,
      blocks,
    });
    return { ok: ts !== null, ts };
  } catch (err) {
    console.error("[notify] notifyReply failed:", err);
    return { ok: false, ts: null };
  }
}

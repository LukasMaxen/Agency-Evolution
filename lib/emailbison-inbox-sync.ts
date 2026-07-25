import pool from "@/lib/db";
import { classifyBounce } from "@/lib/bounce-classifier";
import { isOwnSenderAddress } from "@/lib/own-outbound";

// EmailBison inbox poller. Catches inbound replies that the LEAD_REPLIED
// webhook would not deliver:
//   - Untracked Replies (sent directly to a sender mailbox, not in response
//     to a campaign send). EmailBison stores these but never fires
//     LEAD_REPLIED for them, so without polling they are invisible to us.
//   - Tracked replies whose webhook delivery silently failed.
// For every Inbox item that is not already in our `replies` table, we INSERT
// it with the same shape as the webhook handler and then run the auto-reply
// processor on it. The atomic claim inside processAutoReply keeps things
// safe if the webhook also delivers the same reply mid-poll.

interface BisonReplyItem {
  id: number;
  uuid: string;
  folder: string;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  date_received: string;
  type: string;
  tracked_reply?: boolean;
  automated_reply?: boolean;
  campaign_id: number | null;
  lead_id: number | null;
  sender_email_id: number | null;
  from_name: string | null;
  from_email_address: string | null;
  primary_to_email_address: string | null;
  to_email_addresses?: Array<{ name?: string | null; email_address: string }>;
  cc_email_addresses?: Array<{ name?: string | null; email_address: string }>;
}

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

// Extract the lead's email address from a bounce DSN body.
// Handles all DSN formats seen across the fleet:
//   Gmail:        "Your message to foo@bar.com" / "delivering your message to"
//   M365 group:   "Your message to the Microsoft 365 group foo@bar.com"
//   EOP/Outlook:  "foo@bar.com<mailto:foo@bar.com>" (email before mailto link)
//   "Delivery has failed to these recipients": same mailto pattern
//   PPE/Postfix:  "<foo@bar.com>:" angle bracket
//   Exim:         "The following address(es) failed:\n  foo@bar.com"
//   Dunhill-style: "email address :\n-- foo@bar.com"
//   Mail-Delivery-Service: "To: foo@bar.com" in quoted headers
//   "Failed to deliver to 'foo@bar.com'"
// Returns null when no match or address looks like a daemon/system address.
function extractLeadEmailFromDsn(textBody: string | null): string | null {
  if (!textBody) return null;
  const DAEMON = /^(postmaster|mailer-daemon|noreply|no-reply|bounce|bounces|bounce-handler)@/i;

  const EMAIL = /[\w.+'\-]+@[\w.\-]+\.\w+/;

  const patterns: RegExp[] = [
    // Gmail / Google Workspace (most common)
    /(?:delivering your message to|Your message (?:to|wasn't delivered to))\s+([\w.+'\-]+@[\w.\-]+\.\w+)/i,
    // "couldn't be delivered to email" (Gmail variant)
    /couldn't be delivered to\s+([\w.+'\-]+@[\w.\-]+\.\w+)/i,
    // Microsoft 365 group distribution alias
    /Your message to the Microsoft 365 group\s+([\w.+'\-]+@[\w.\-]+\.\w+)/i,
    // Microsoft 365 forwarding failure (lead's mailbox tried to forward)
    /couldn't be forwarded from\s+([\w.+'\-]+@[\w.\-]+\.\w+)/i,
    // EOP / Outlook: email immediately before <mailto: link
    /([\w.+'\-]+@[\w.\-]+\.\w+)<mailto:/i,
    // "Failed to deliver to 'email'" (various mailers)
    /Failed to deliver to ['"]?([\w.+'\-]+@[\w.\-]+\.\w+)/i,
    // Exim / sendmail: "The following address(es) failed:\n\n  email"
    /The following address(?:es)? failed:[\s\S]{0,200}?[ \t]+([\w.+'\-]+@[\w.\-]+\.\w+)/i,
    // Dunhill-style: "email address :\n-- email"
    /email address\s*:?\s*\n[ \t]*-+[ \t]*([\w.+'\-]+@[\w.\-]+\.\w+)/i,
    // Mail-Delivery-Service quoted header: "To: email"
    /\bTo:[ \t]+([\w.+'\-]+@[\w.\-]+\.\w+)/i,
    // Postfix / PPE angle-bracket: <email>
    /<([\w.+'\-]+@[\w.\-]+\.\w+)>/,
    // SMTP response parenthetical: (email:something)
    /\(([\w.+'\-]+@[\w.\-]+\.\w+)[):]/,
  ];

  for (const re of patterns) {
    const m = textBody.match(re);
    if (m?.[1] && !DAEMON.test(m[1]) && EMAIL.test(m[1])) return m[1].toLowerCase();
  }
  return null;
}

let running = false;

// Anything older than this is left alone — protects against backfilling
// years of historical untracked replies on a fresh deploy.
const MAX_AGE_HOURS = 24;

export async function runEmailBisonInboxSync(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const wss = await pool.query(`
      SELECT id, name, slug, email_bison_api_key, email_bison_instance_url
      FROM workspaces
      WHERE email_bison_api_key IS NOT NULL
        AND email_bison_instance_url IS NOT NULL
        AND slug NOT IN ('itg-group', 'sonaro-ai', 'sro-consulting')
    `);

    const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
    const { processAutoReply } = await import("@/app/api/auto-reply/processor");
    let totalNew = 0;

    for (const ws of wss.rows) {
      try {
        const r = await fetch(
          `${ws.email_bison_instance_url}/api/replies?per_page=50`,
          { headers: { Authorization: `Bearer ${ws.email_bison_api_key}` } }
        );
        if (!r.ok) {
          console.error(`[inbox-sync] ${ws.slug} fetch failed: ${r.status}`);
          continue;
        }
        const body = await r.json();
        const items: BisonReplyItem[] = body?.data ?? [];

        for (const item of items) {
          if (item.folder !== "Inbox") continue;
          if (item.automated_reply) continue;
          const receivedAt = new Date(item.date_received);
          if (receivedAt.getTime() < cutoff) continue;
          if (!item.uuid || !item.from_email_address) continue;

          // Skip if already in our DB. Cheap check before INSERT.
          const existing = await pool.query(
            "SELECT 1 FROM replies WHERE id = $1",
            [item.uuid]
          );
          if (existing.rows.length > 0) continue;

          // Own-outbound guard: if the author is one of our own sender accounts,
          // this is our outbound surfacing in the inbox, not a lead reply. Skip
          // ingestion entirely so it never reaches the processor or Slack.
          if (await isOwnSenderAddress(ws.slug, item.from_email_address)) {
            console.log(`[inbox-sync] ${ws.slug} skipped own outbound from ${item.from_email_address}`);
            continue;
          }

          const leadName = item.from_name ?? item.from_email_address;
          const message = extractCleanBody(item.text_body ?? "");

          // EB distinguishes Tracked Reply (real response to a campaign send)
          // from Untracked Reply (any other inbound — newsletters, fresh cold
          // outreach to a sender mailbox, transactional). Only Tracked Reply
          // counts toward the reply rate KPI in /api/account-monitor.
          const isTracked =
            typeof item.tracked_reply === "boolean"
              ? item.tracked_reply
              : item.type === "Tracked Reply";

          const inserted = await pool.query(
            `INSERT INTO replies (
               id, workspace_id, workspace_slug, email_bison_id,
               email_bison_reply_id, email_bison_lead_id,
               lead_email, lead_name, lead_company, lead_title,
               sender_email, sender_email_id,
               to_email, to_name,
               campaign, subject, message,
               received_at, status, interested,
               reply_type, tracked_reply
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'new',NULL,$19,$20)
             ON CONFLICT (id) DO NOTHING
             RETURNING id`,
            [
              item.uuid, ws.id, ws.slug, item.uuid,
              item.id, item.lead_id ?? null,
              item.from_email_address, leadName,
              null, null,
              item.primary_to_email_address ?? "", item.sender_email_id ?? null,
              item.primary_to_email_address ?? "", leadName,
              "", item.subject ?? "", message,
              receivedAt,
              item.type ?? null, isTracked,
            ]
          );

          if (inserted.rowCount === 0) continue; // raced with webhook, skip

          totalNew++;
          console.log(
            `[inbox-sync] ${ws.slug} new reply ${item.uuid} from ${item.from_email_address} (${item.type})`
          );

          try {
            await processAutoReply(item.uuid, ws.slug);
            // Pace between calls to avoid hitting Anthropic rate limits.
            await new Promise(r => setTimeout(r, 3000));
          } catch (err: any) {
            console.error(
              `[inbox-sync] processAutoReply failed for ${item.uuid}:`,
              err?.message ?? err
            );
          }
        }
      } catch (err: any) {
        console.error(`[inbox-sync] ${ws.slug} failed:`, err?.message ?? err);
      }
    }

    if (totalNew > 0) {
      console.log(
        `[inbox-sync] inserted ${totalNew} new replies across ${wss.rows.length} workspaces`
      );
    }

    // ── BOUNCED FOLDER PASS ────────────────────────────────────────────
    // Pulls bounce DSNs from EB's Bounced folder and writes enriched rows
    // into email_bounces (subject, body, provider, category). The
    // EMAIL_BOUNCED webhook only gives us a coarse "unknown" row; this
    // pass adds the classification needed to distinguish data failures
    // (bad recipient) from domain burn (we are being throttled).
    //
    // Runs for every workspace with EB creds, including the ones excluded
    // from the Inbox pass above, so deliverability tracking covers the
    // entire fleet.
    const allBounceWss = await pool.query(`
      SELECT slug, email_bison_api_key, email_bison_instance_url
      FROM workspaces
      WHERE email_bison_api_key IS NOT NULL
        AND email_bison_instance_url IS NOT NULL
    `);

    let totalBouncesIngested = 0;
    for (const ws of allBounceWss.rows) {
      try {
        const r = await fetch(
          `${ws.email_bison_instance_url}/api/replies?type=Bounced&per_page=250`,
          { headers: { Authorization: `Bearer ${ws.email_bison_api_key}` } }
        );
        if (!r.ok) {
          console.error(`[inbox-sync] ${ws.slug} bounce fetch failed: ${r.status}`);
          continue;
        }
        const body = await r.json();
        const items: BisonReplyItem[] = body?.data ?? [];

        let inserted = 0;
        for (const item of items) {
          if (!item.uuid) continue;
          const receivedAt = new Date(item.date_received);
          if (receivedAt.getTime() < cutoff) continue;

          // Pre-filter: EB files some human autoresponders under the
          // Bounced folder (OOO replies, inactive-user notices, etc.).
          // Real bounce DSNs come from daemon mailboxes, or are auto
          // replies whose subject matches a known DSN pattern.
          const fromAddr = item.from_email_address || "";
          const looksLikeBounce =
            /^(postmaster|mailer-daemon|noreply|no-reply|bounce|bounces|bounce-handler)@/i.test(fromAddr) ||
            (item.automated_reply === true &&
              /(Delivery Status Notification|Undeliverable|Undelivered Mail|Mail Delivery|Returned to Sender|Failure Notice)/i.test(item.subject || ""));
          if (!looksLikeBounce) continue;

          // Idempotent: skip if we've already ingested this bounce uuid.
          const existing = await pool.query(
            "SELECT 1 FROM email_bounces WHERE eb_reply_uuid = $1",
            [item.uuid]
          );
          if (existing.rows.length > 0) continue;

          const cls = classifyBounce({
            subject:   item.subject,
            textBody:  item.text_body,
            fromEmail: item.from_email_address,
          });

          const senderEmail = item.primary_to_email_address ?? null;
          const leadEmail   = extractLeadEmailFromDsn(item.text_body);
          const reason      = (item.text_body ?? "").slice(0, 1000);
          const rowId       = `bounce-poll-${ws.slug}-${item.id}`;

          const ins = await pool.query(
            `INSERT INTO email_bounces (
               id, workspace_slug, lead_email, lead_name, campaign_name,
               bounce_type, bounced_at,
               sender_email, sender_email_id,
               eb_reply_id, eb_reply_uuid,
               bounce_subject, bounce_reason, bounce_category, provider
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (id) DO NOTHING`,
            [
              rowId, ws.slug,
              leadEmail, null, "",
              cls.category,
              receivedAt,
              senderEmail,
              item.sender_email_id ?? null,
              item.id, item.uuid,
              item.subject ?? null,
              reason,
              cls.category,
              cls.provider,
            ]
          );
          if (ins.rowCount && ins.rowCount > 0) inserted++;
        }

        if (inserted > 0) {
          totalBouncesIngested += inserted;
          console.log(`[inbox-sync] ${ws.slug} ingested ${inserted} new bounces`);
        }
      } catch (err: any) {
        console.error(`[inbox-sync] ${ws.slug} bounce pass failed:`, err?.message ?? err);
      }
    }

    if (totalBouncesIngested > 0) {
      console.log(
        `[inbox-sync] ingested ${totalBouncesIngested} new bounces across ${allBounceWss.rows.length} workspaces`
      );
    }

    // ── SENT FOLDER PASS ───────────────────────────────────────────────
    // EB stores everything Nicklas sends manually from the EB UI (replies
    // to inbound, ad-hoc follow-ups). Our sent_emails table only captures
    // sends that go through /api/send-reply (i.e. the processor or the
    // dashboard composer). Without this pass the queue looks misleading,
    // because manually-handled leads keep showing as "no reply sent".
    //
    // We only ingest a Sent item when there's a matching inbound `replies`
    // row (same lead + workspace) older than the send. That filters out
    // campaign sends and scheduled follow-ups to never-replied leads,
    // which belong in `emails_sent`, not `sent_emails`.
    let totalSentIngested = 0;
    for (const ws of wss.rows) {
      try {
        const r = await fetch(
          `${ws.email_bison_instance_url}/api/replies?per_page=100&type=Sent`,
          { headers: { Authorization: `Bearer ${ws.email_bison_api_key}` } }
        );
        if (!r.ok) {
          console.error(`[inbox-sync] ${ws.slug} sent fetch failed: ${r.status}`);
          continue;
        }
        const body = await r.json();
        const items: BisonReplyItem[] = body?.data ?? [];

        for (const item of items) {
          if (item.folder !== "Sent") continue;
          const sentAt = new Date(item.date_received);
          if (sentAt.getTime() < cutoff) continue;

          const recipient = item.to_email_addresses?.[0]?.email_address
            ?? item.primary_to_email_address
            ?? null;
          if (!recipient) continue;

          const stableId = `eb-sent-${ws.slug}-${item.id}`;
          const dup = await pool.query(
            "SELECT 1 FROM sent_emails WHERE id = $1",
            [stableId]
          );
          if (dup.rows.length > 0) continue;

          // Find the matching inbound reply: most recent reply from this
          // lead in this workspace, received before the send. If none
          // exists, this is a campaign send (skip).
          const match = await pool.query(
            `SELECT id, lead_name FROM replies
             WHERE workspace_slug = $1
               AND lead_email = $2
               AND received_at <= $3
             ORDER BY received_at DESC
             LIMIT 1`,
            [ws.slug, recipient, sentAt]
          );
          if (match.rows.length === 0) continue;

          const matchedReplyId: string = match.rows[0].id;
          const leadName: string = match.rows[0].lead_name ?? recipient;
          const bodyText = item.text_body ?? item.html_body ?? "";

          await pool.query(
            `INSERT INTO sent_emails
               (id, reply_id, workspace_slug, lead_email, lead_name,
                email_type, subject, body, sent_at, sent_by)
             VALUES ($1, $2, $3, $4, $5, 'reply', $6, $7, $8, 'emailbison-manual')
             ON CONFLICT (id) DO NOTHING`,
            [
              stableId,
              matchedReplyId,
              ws.slug,
              recipient,
              leadName,
              item.subject ?? null,
              bodyText,
              sentAt,
            ]
          );

          // If the matched reply was still sitting in a queue state, flip
          // it to 'replied' since EB confirms a reply went out.
          await pool.query(
            `UPDATE replies SET status = 'replied'
             WHERE id = $1
               AND status IN ('new', 'awaiting_approval', 'awaiting_manual')`,
            [matchedReplyId]
          );

          totalSentIngested++;
        }
      } catch (err: any) {
        console.error(`[inbox-sync] ${ws.slug} sent pass failed:`, err?.message ?? err);
      }
    }

    if (totalSentIngested > 0) {
      console.log(
        `[inbox-sync] ingested ${totalSentIngested} new sent_emails rows from EB Sent folders`
      );
    }
  } finally {
    running = false;
  }
}

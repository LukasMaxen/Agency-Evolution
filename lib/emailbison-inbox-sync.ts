import pool from "@/lib/db";

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
  date_received: string;
  type: string;
  automated_reply?: boolean;
  campaign_id: number | null;
  lead_id: number | null;
  sender_email_id: number | null;
  from_name: string | null;
  from_email_address: string | null;
  primary_to_email_address: string | null;
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

          const leadName = item.from_name ?? item.from_email_address;
          const message = extractCleanBody(item.text_body ?? "");

          const inserted = await pool.query(
            `INSERT INTO replies (
               id, workspace_id, workspace_slug, email_bison_id,
               email_bison_reply_id, email_bison_lead_id,
               lead_email, lead_name, lead_company, lead_title,
               sender_email, sender_email_id,
               to_email, to_name,
               campaign, subject, message,
               received_at, status, interested
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'new',NULL)
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
            ]
          );

          if (inserted.rowCount === 0) continue; // raced with webhook, skip

          totalNew++;
          console.log(
            `[inbox-sync] ${ws.slug} new reply ${item.uuid} from ${item.from_email_address} (${item.type})`
          );

          try {
            await processAutoReply(item.uuid, ws.slug);
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
  } finally {
    running = false;
  }
}

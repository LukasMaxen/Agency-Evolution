import pool from "@/lib/db";
import { addReaction, approvalChannelFor, postToSlack } from "@/lib/slack-approval";

/**
 * A reply just went out to this lead outside the approval card (a human answered by
 * hand in EmailBison). Every still-pending #reply-approval card for an inbound that this
 * send answered is now stale: acting on it double-messages the lead. Marks those drafts
 * 'superseded', flips the reply rows to 'replied', and flags the Slack card with a
 * :no_entry_sign: reaction plus a thread note saying who/when, so nobody acts on it.
 *
 * Only drafts for inbounds received BEFORE the send are closed. A card for a newer
 * inbound (the lead answering our manual reply) stays live, because that one really
 * does still need a response.
 *
 * Called from the MANUAL_EMAIL_SENT webhook (real time) and the inbox-sync Sent pass
 * (10 min backstop). Never throws.
 */
export async function supersedeAnsweredDrafts(
  workspaceSlug: string,
  recipient: string | null | undefined,
  sentAt: Date,
  sentBy = "a human in EmailBison",
): Promise<number> {
  if (!workspaceSlug || !recipient) return 0;
  try {
    const r = await pool.query<{ id: string; reply_id: string; slack_ts: string | null }>(
      `UPDATE reply_drafts rd
          SET status = 'superseded', reviewed_at = NOW(), reviewed_by = 'auto:answered_outside_card'
         FROM replies r
        WHERE rd.reply_id = r.id
          AND rd.status = 'pending'
          AND rd.workspace_slug = $1
          AND (lower(r.lead_email) = lower($2) OR lower(r.preferred_recipient_email) = lower($2))
          AND r.received_at < $3::timestamptz
        RETURNING rd.id, rd.reply_id, rd.slack_ts`,
      [workspaceSlug, recipient, sentAt],
    );
    if (!r.rows.length) return 0;

    await pool.query(
      `UPDATE replies SET status = 'replied'
        WHERE id = ANY($1) AND status IN ('new', 'awaiting_approval', 'awaiting_manual')`,
      [r.rows.map(x => x.reply_id)],
    );

    const channel = await approvalChannelFor(workspaceSlug);
    const when = sentAt.toISOString().slice(0, 16).replace("T", " ") + " UTC";
    for (const row of r.rows) {
      if (!row.slack_ts) continue;
      await addReaction(channel, row.slack_ts, "no_entry_sign");
      await postToSlack({
        channel,
        threadTs: row.slack_ts,
        text: `:no_entry_sign: *Already answered, do NOT reply.* ${sentBy} replied to this lead at ${when}, after this message came in. Card closed automatically, this draft will not send. If the lead writes back, a new card will appear.`,
      });
    }
    console.log(`[stale-drafts] superseded ${r.rows.length} pending draft(s) for ${recipient} (${workspaceSlug})`);
    return r.rows.length;
  } catch (err: any) {
    console.error(`[stale-drafts] supersedeAnsweredDrafts failed for ${recipient}:`, err?.message ?? err);
    return 0;
  }
}

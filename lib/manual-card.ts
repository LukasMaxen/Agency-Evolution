import pool from "@/lib/db";
import { deleteSlackMessage } from "@/lib/slack-approval";

/**
 * Persists where a #manual-replies card was posted (channel + Slack ts) onto the reply
 * row itself, so it can be found and cleaned up later if the lead ends up booking through
 * another path (Calendly self-service, a human booking manually, or the AI itself detecting
 * a confirmed booking) before anyone acts on the card. Stored in ai_analysis since replies
 * has no dedicated column for this and adding one requires a DDL migration.
 */
export async function recordManualCard(replyId: string, channel: string, ts: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE replies SET ai_analysis = jsonb_set(COALESCE(ai_analysis,'{}'::jsonb), '{manual_card}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify({ channel, ts }), replyId]
    );
  } catch (err: any) {
    console.error(`[manual-card] failed to record card location for ${replyId}:`, err?.message ?? err);
  }
}

/**
 * Call this anywhere meeting_booked gets set to TRUE (Calendly webhook, manual call
 * booking, or the AI's own flag_meeting_booked detection). Finds every reply for this
 * lead that still has a tracked #manual-replies card (see recordManualCard) and deletes
 * it, so nobody reacts to a card asking them to schedule a lead who has already booked.
 *
 * Sweeps by lead email rather than a single reply id because the row that gets
 * meeting_booked=TRUE (e.g. the Calendly webhook matches "most recent reply by email")
 * is not always the same row the manual card was posted against — a lead can have
 * multiple reply rows, and the card may be tracked on an earlier one (the Rebecca /
 * epigenics.de incident, 2026-08-13: the webhook booking landed on one reply, the manual
 * card was posted moments later against a second, newer reply from the same lead).
 */
export async function closeManualCardsForLead(leadEmail: string | null | undefined): Promise<void> {
  if (!leadEmail) return;
  try {
    const r = await pool.query<{ id: string; manual_card: { channel: string; ts: string } | null }>(
      `SELECT id, ai_analysis->'manual_card' AS manual_card FROM replies WHERE lead_email = $1 AND ai_analysis ? 'manual_card'`,
      [leadEmail]
    );
    for (const row of r.rows) {
      const card = row.manual_card;
      if (!card?.channel || !card?.ts) continue;
      await deleteSlackMessage(card.channel, card.ts);
      await pool.query(`UPDATE replies SET ai_analysis = ai_analysis - 'manual_card' WHERE id = $1`, [row.id]);
      console.log(`[manual-card] closed stale manual-replies card for ${row.id} (${leadEmail}, meeting booked)`);
    }
  } catch (err: any) {
    console.error(`[manual-card] closeManualCardsForLead failed for ${leadEmail}:`, err?.message ?? err);
  }
}

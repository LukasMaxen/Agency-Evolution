// Shared send-time guards against sending a reply we should not send.
//
// TWO complementary checks, both applied immediately before every REPLY send (the
// auto-reply processor's sendToEmailBison, the Slack-approve / dashboard proxy in
// /api/send-reply, and the manual catch-up tooling). NEITHER is applied on the follow-up
// path — follow-ups are SUPPOSED to send when we spoke last and the lead went quiet.
//
//  1. weSpokeLast — the most recent message in the thread is already ours (Sent). Blocks
//     replying when we had the last word (e.g. a human replied by hand first).
//
//  2. alreadySentBody — we have already sent this exact message to this lead. This is the
//     one that actually catches the Justin/SuperBonsai incident (2026-07-24): a stale
//     catch-up run re-sent an identical pitch to a lead who had since replied "just
//     booked", so the LEAD had spoken last (weSpokeLast would not fire) but the body was
//     a duplicate of one already sent.
//
// Both fail OPEN (return false) on any error, so a transient EmailBison/DB/network
// problem never blocks a legitimate first reply.

import pool from "@/lib/db";

/** Normalize a reply body so duplicate detection ignores signature/whitespace/case. */
export function normalizeForDedup(body: string): string {
  return (body || "")
    .replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "")
    .replace(/https?:\/\/\S+/g, "") // ignore link tracking-param differences
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * True if an identical reply body has already been sent to this lead in the last 30 days.
 * Exact normalized match only, so it can never block a genuinely different reply.
 */
export async function alreadySentBody(leadEmail: string, body: string): Promise<boolean> {
  const target = normalizeForDedup(body);
  if (!leadEmail || target.length < 15) return false;
  try {
    const rows = await pool.query(
      `SELECT body FROM sent_emails WHERE lead_email = $1 AND sent_at > NOW() - INTERVAL '30 days' ORDER BY sent_at DESC LIMIT 25`,
      [leadEmail],
    );
    return rows.rows.some((r: { body: string }) => normalizeForDedup(r.body) === target);
  } catch {
    return false;
  }
}

export async function weSpokeLast(
  instanceUrl: string,
  apiKey: string,
  leadEmail: string,
): Promise<boolean> {
  if (!instanceUrl || !apiKey || !leadEmail) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    let res: Response;
    try {
      res = await fetch(
        `${instanceUrl}/api/replies?per_page=50&search=${encodeURIComponent(leadEmail)}`,
        { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, signal: ctrl.signal },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return false;
    const items: Array<{ folder?: string; date_received?: string; date_sent?: string }> =
      (await res.json())?.data ?? [];
    if (!items.length) return false;
    // Pick the single most recent message by timestamp and check whether it is ours.
    let latest = items[0];
    let latestMs = -Infinity;
    for (const it of items) {
      const ms = new Date(it.date_received || it.date_sent || 0).getTime();
      if (ms >= latestMs) { latestMs = ms; latest = it; }
    }
    return latest?.folder === "Sent";
  } catch {
    return false;
  }
}

// Shared "did we speak last?" send-time guard.
//
// Returns true when the most recent message in the lead's EmailBison thread is one of
// OUR sent replies (Sent folder), i.e. we already had the last word. Every REPLY path
// must check this immediately before sending so we can never answer an email we already
// replied to — the double-send that hit Justin/SuperBonsai (2026-07-24), where a stale
// catch-up run re-sent a pitch to a lead who had already booked.
//
// Applied on: the auto-reply processor (sendToEmailBison), the Slack-approve / dashboard
// proxy (/api/send-reply), and the manual catch-up tooling. NOT applied on the follow-up
// path — follow-ups are SUPPOSED to send when we spoke last and the lead went quiet.
//
// Fails OPEN (returns false) on any error, so a transient EmailBison/network problem
// never blocks a legitimate first reply.

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

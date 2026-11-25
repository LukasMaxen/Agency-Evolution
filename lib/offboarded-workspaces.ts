// Offboarded clients whose EmailBison workspaces may still be live (webhooks registered,
// campaigns sending, Calendly org webhook still firing) but that we no longer manage.
// Every Slack notification path checks this set: auto-reply cards (#reply-approval,
// #manual-replies, errored/crash cards), the raw reply feed, meeting booked/cancelled
// posts, stale-draft notices and the health monitor. Replies are still stored in the DB
// (marked status='read'), nothing is drafted, sent or posted.
//
// 2026-11-25: Austin Heaton / AEO Consulting offboarded (Kasper). Both the Shields
// (ah-consulting) and AE (ah-consulting-2) workspaces.
//
// Exception: MP Consulting ran its earlier campaigns on Austin's workspaces before it got
// its own (mp-consulting, 2026-10-13). A late reply to one of those MP threads is still
// processed normally, detected by the same content sniff as isMPConsultingReply in
// app/api/auto-reply/processor.ts.
export const OFFBOARDED_WORKSPACES = new Set<string>(["ah-consulting", "ah-consulting-2"]);

export function isOffboardedWorkspace(slug: string | null | undefined): boolean {
  return !!slug && OFFBOARDED_WORKSPACES.has(slug);
}

export function isMPConsultingText(...parts: (string | null | undefined)[]): boolean {
  const text = parts.map(p => p ?? "").join("\n").toLowerCase();
  return (
    /\bmp consulting\b/.test(text) ||
    /independent optometry practices/.test(text) ||
    /mpc-maddie/.test(text) ||
    /mackenzie poteat/.test(text)
  );
}

// True when a reply on this workspace must be fully silenced (offboarded, and not an
// MP Consulting straggler).
export function isSilencedReply(slug: string | null | undefined, ...content: (string | null | undefined)[]): boolean {
  return isOffboardedWorkspace(slug) && !isMPConsultingText(...content);
}

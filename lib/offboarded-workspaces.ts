// Offboarded clients whose EmailBison workspaces may still be live (webhooks registered,
// campaigns sending, Calendly webhooks or pollers still firing) but that we no longer
// manage. Every Slack notification path checks this set: auto-reply cards
// (#reply-approval, #manual-replies, errored/crash cards), the raw reply feed, meeting
// booked/cancelled posts, stale-draft notices and the health monitor. Replies are still
// stored in the DB (marked status='read'), nothing is drafted, sent or posted.
//
// 2026-11-25: Austin Heaton / AEO Consulting offboarded (Kasper). Both the Shields
// (ah-consulting) and AE (ah-consulting-2) workspaces.
// 2026-11-25: MP Consulting offboarded (Kasper). Its own Shields workspace (mp-consulting);
// its older campaigns on Austin's workspaces are covered by the entries above.
//
// Mirrored by hand in scripts/lead_monitoring.py and scripts/csm-update.config.json.
export const OFFBOARDED_WORKSPACES = new Set<string>(["ah-consulting", "ah-consulting-2", "mp-consulting"]);

export function isOffboardedWorkspace(slug: string | null | undefined): boolean {
  return !!slug && OFFBOARDED_WORKSPACES.has(slug);
}

// True when a reply on this workspace must be fully silenced. Takes the reply content so
// a per-content exception can be added again later without touching callers.
export function isSilencedReply(slug: string | null | undefined, ..._content: (string | null | undefined)[]): boolean {
  return isOffboardedWorkspace(slug);
}

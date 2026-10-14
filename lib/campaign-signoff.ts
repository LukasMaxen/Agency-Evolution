import { normalizeSignature } from "@/lib/slack-approval";

// Per-campaign sign-off overrides. Normally every reply ends with
// {SENDER_EMAIL_SIGNATURE}, which EmailBison resolves to the sender's own signature.
// Some campaigns borrow another client's inboxes, where that signature would be wrong.
//
// Cheap Assist "AE - Outreach" (Kasper, 2026-10-14): half of Cheap Assist's sender
// accounts also send internal Agency Evolution outreach from this ONE campaign. The
// inbox signature says "Cheap Assist | Co-Founder", so it is replaced with an Agency
// Evolution sign-off. Exact campaign-name match only: every Arlo campaign in the same
// workspace also starts with "AE - " (AE - Law Firms, AE - Agencies, ...).
//
// The sender name is written in literally from EmailBison's sender record rather than
// left as {SENDER_FULL_NAME}, which is only confirmed to resolve in campaign copy.

const AE_OUTREACH_CAMPAIGN = "ae - outreach";

function normCampaign(campaign: string | null | undefined): string {
  return String(campaign ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** True for the internal Agency Evolution campaign that runs on Cheap Assist inboxes. */
export function isCheapAssistAEOutreach(workspaceSlug: string | null | undefined, campaign: string | null | undefined): boolean {
  return workspaceSlug === "cheap-assist" && normCampaign(campaign) === AE_OUTREACH_CAMPAIGN;
}

function signoffFor(workspaceSlug: string | null | undefined, campaign: string | null | undefined): ((senderName: string) => string) | null {
  if (isCheapAssistAEOutreach(workspaceSlug, campaign)) {
    return name => `Best,\n${name}\nHead of Development | Agency Evolution`;
  }
  return null;
}

async function fetchSenderName(instanceUrl: string, apiKey: string, senderEmailId: string | number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${instanceUrl}/api/sender-emails/${senderEmailId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const name = String((data?.data ?? data)?.name ?? "").trim();
    return name || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send-gate step, call right before POSTing a reply to EmailBison. For campaigns
 * without an override it returns the body unchanged (still ending in
 * {SENDER_EMAIL_SIGNATURE}). For an override campaign it swaps the variable for the
 * custom sign-off. Returns null when the override applies but the sender name cannot
 * be resolved: the caller must NOT send, rather than fall back to the wrong signature.
 */
export async function applyCampaignSignoff(
  body: string,
  reply: Record<string, any>,
  instanceUrl: string,
  apiKey: string
): Promise<string | null> {
  const signoff = signoffFor(reply.workspace_slug, reply.campaign);
  if (!signoff) return body;
  const name = reply.sender_email_id ? await fetchSenderName(instanceUrl, apiKey, reply.sender_email_id) : null;
  if (!name) {
    console.error(`[campaign-signoff] BLOCKED send: no sender name for ${reply.workspace_slug} / ${reply.campaign} (reply ${reply.id ?? reply.email_bison_reply_id})`);
    return null;
  }
  // normalizeSignature strips any hand-written closer and leaves exactly one
  // variable at the end, which is then replaced by the custom block.
  const clean = normalizeSignature(body).replace(/\n*\{SENDER_EMAIL_SIGNATURE\}\s*$/i, "").trimEnd();
  return `${clean}\n\n${signoff(name)}`;
}

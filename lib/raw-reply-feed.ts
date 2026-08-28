import { postToSlack } from "@/lib/slack-approval";

// Temporary hardcoded workspace -> Slack channel map for the raw "every reply"
// notification feed (mirrors Make.com's unfiltered "Reply received" post, one
// message per inbound reply regardless of AI classification).
//
// This should really live in workspaces.slack_channel_replies (see
// migrations/008_workspace_notification_config.sql), which app/api/webhook/
// [workspace]/route.ts already reads. That migration has never been applied
// to production (needs a DB superuser, aird cannot run DDL), so the column
// does not exist. Hardcoded here so WithPebble and AEO Consulting work today
// without it. Once migration 008 runs, replace this with
// workspace.slack_channel_replies and delete this file.
export const RAW_REPLY_FEED_CHANNELS: Record<string, string> = {
  "with-pebble": "C0BSXAE4JLB",
  "ah-consulting": "C0BT77S0SJG",
};

// Per-workspace cache of EmailBison sender_email_id -> email address and
// campaign_id -> campaign name. The inbox-sync poller only gets numeric IDs
// back from GET /api/replies, not the resolved objects the LEAD_REPLIED
// webhook payload carries, so these are resolved here and cached in-process
// to avoid one extra API call per reply.
const senderCache = new Map<string, Map<number, string | null>>();
const campaignCache = new Map<string, Map<number, string | null>>();

// EmailBison's sender-emails/campaigns list endpoints paginate at 15/page
// with no size override that's honored, and IDs are not contiguous across
// a workspace's history (accounts can be old shared instances with 1000+
// unrelated senders) — scanning pages to find one ID is impractical.
// Direct single-resource lookups exist and are cheap, so use those.
async function resolveSenderEmail(
  workspaceSlug: string,
  instanceUrl: string,
  apiKey: string,
  senderEmailId: number | null | undefined
): Promise<string | null> {
  if (!senderEmailId) return null;
  let cache = senderCache.get(workspaceSlug);
  if (!cache) {
    cache = new Map();
    senderCache.set(workspaceSlug, cache);
  }
  if (cache.has(senderEmailId)) return cache.get(senderEmailId) ?? null;

  try {
    const r = await fetch(`${instanceUrl}/api/sender-emails/${senderEmailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const email: string | null = r.ok ? (await r.json())?.data?.email ?? null : null;
    cache.set(senderEmailId, email);
    return email;
  } catch {
    return null;
  }
}

async function resolveCampaignName(
  workspaceSlug: string,
  instanceUrl: string,
  apiKey: string,
  campaignId: number | null | undefined
): Promise<string | null> {
  if (!campaignId) return null;
  let cache = campaignCache.get(workspaceSlug);
  if (!cache) {
    cache = new Map();
    campaignCache.set(workspaceSlug, cache);
  }
  if (cache.has(campaignId)) return cache.get(campaignId) ?? null;

  try {
    const r = await fetch(`${instanceUrl}/api/campaigns/${campaignId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const name: string | null = r.ok ? (await r.json())?.data?.name ?? null : null;
    cache.set(campaignId, name);
    return name;
  } catch {
    return null;
  }
}

export interface RawReplyFeedOpts {
  workspaceSlug: string;
  instanceUrl: string;
  apiKey: string;
  leadEmail: string;
  emailBisonUuid: string;
  subject: string;
  message: string;
  // Already-known values (webhook payload carries these directly) take
  // priority over resolving from the *_Id fields (poller only has IDs).
  senderEmail?: string | null;
  senderEmailId?: number | null;
  campaignName?: string | null;
  campaignId?: number | null;
}

// Mirrors Make.com's raw "Reply received" notification, field for field.
// Fires for every reply regardless of AI classification — this is the
// unconditional visibility feed, not the AI approval-card flow.
export async function postRawReplyFeed(opts: RawReplyFeedOpts): Promise<void> {
  const channel = RAW_REPLY_FEED_CHANNELS[opts.workspaceSlug];
  if (!channel) return;

  const [senderEmail, campaignName] = await Promise.all([
    opts.senderEmail
      ? Promise.resolve(opts.senderEmail)
      : resolveSenderEmail(opts.workspaceSlug, opts.instanceUrl, opts.apiKey, opts.senderEmailId),
    opts.campaignName
      ? Promise.resolve(opts.campaignName)
      : resolveCampaignName(opts.workspaceSlug, opts.instanceUrl, opts.apiKey, opts.campaignId),
  ]);

  const viewUrl = `${opts.instanceUrl}/inbox/replies/${opts.emailBisonUuid}`;

  const text = [
    "*Reply received*",
    "",
    "*Lead:*",
    opts.leadEmail,
    "",
    "*Email account:*",
    senderEmail || "_unknown_",
    "",
    "*Campaign:*",
    campaignName || "_unknown_",
    "",
    "*View in EmailBison:*",
    viewUrl,
    "",
    "*Subject Line*",
    opts.subject || "_(no subject)_",
    "",
    "*Message:*",
    opts.message || "_(empty)_",
  ].join("\n");

  try {
    await postToSlack({ channel, text: text.slice(0, 3900) });
  } catch (err: any) {
    console.error(`[raw-reply-feed] post failed for ${opts.workspaceSlug}/${opts.emailBisonUuid}:`, err?.message ?? err);
  }
}

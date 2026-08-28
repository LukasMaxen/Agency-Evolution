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
const senderCache = new Map<string, Map<number, string>>();
const campaignCache = new Map<string, Map<number, string>>();

async function resolveSenderEmail(
  workspaceSlug: string,
  instanceUrl: string,
  apiKey: string,
  senderEmailId: number | null | undefined
): Promise<string | null> {
  if (!senderEmailId) return null;
  let cache = senderCache.get(workspaceSlug);
  if (!cache || !cache.has(senderEmailId)) {
    cache = new Map();
    try {
      const r = await fetch(`${instanceUrl}/api/sender-emails?page=1`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.ok) {
        const body = await r.json();
        for (const s of body?.data ?? []) {
          if (s?.id && s?.email) cache.set(s.id, s.email);
        }
      }
    } catch {
      // best effort — fall through with whatever the cache already has
    }
    senderCache.set(workspaceSlug, cache);
  }
  return cache.get(senderEmailId) ?? null;
}

async function resolveCampaignName(
  workspaceSlug: string,
  instanceUrl: string,
  apiKey: string,
  campaignId: number | null | undefined
): Promise<string | null> {
  if (!campaignId) return null;
  let cache = campaignCache.get(workspaceSlug);
  if (!cache || !cache.has(campaignId)) {
    cache = new Map();
    try {
      const r = await fetch(`${instanceUrl}/api/campaigns?per_page=200`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.ok) {
        const body = await r.json();
        for (const c of body?.data ?? []) {
          if (c?.id && c?.name) cache.set(c.id, c.name);
        }
      }
    } catch {
      // best effort
    }
    campaignCache.set(workspaceSlug, cache);
  }
  return cache.get(campaignId) ?? null;
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

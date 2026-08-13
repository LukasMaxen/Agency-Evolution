import crypto from "crypto";
import pool from "@/lib/db";

// Approval channels. Override per env var if needed.
export const REPLY_APPROVAL_CHANNEL =
  process.env.REPLY_APPROVAL_SLACK_CHANNEL ?? "#reply-approval";
export const FU_APPROVAL_CHANNEL =
  process.env.FU_APPROVAL_SLACK_CHANNEL ?? "#follow-up-approval";
export const MANUAL_REPLIES_CHANNEL =
  process.env.MANUAL_REPLIES_SLACK_CHANNEL ?? "#manual-replies";
export const FEEDBACK_REVIEW_CHANNEL =
  process.env.FEEDBACK_REVIEW_SLACK_CHANNEL ?? "#feedback-review";

// Per-workspace override for the reply-approval + manual-replies channels.
// Reads workspaces.slack_approval_channel (set per workspace, NULL falls back to global).
// Used for client-managed approval (e.g. Sonaro reacts ✅/✏️/❌ in their own channel).
// Universal-rule escalations and feedback-review STILL go to the global FEEDBACK_REVIEW_CHANNEL,
// so a client can't accidentally write a company-wide rule.
const approvalChannelCache = new Map<string, string | null>();
export async function approvalChannelFor(workspaceSlug: string): Promise<string> {
  if (approvalChannelCache.has(workspaceSlug)) {
    return approvalChannelCache.get(workspaceSlug) ?? REPLY_APPROVAL_CHANNEL;
  }
  try {
    const r = await pool.query<{ slack_approval_channel: string | null }>(
      `SELECT slack_approval_channel FROM workspaces WHERE slug = $1`,
      [workspaceSlug]
    );
    const override = r.rows[0]?.slack_approval_channel ?? null;
    approvalChannelCache.set(workspaceSlug, override);
    return override ?? REPLY_APPROVAL_CHANNEL;
  } catch (err: any) {
    // Pre-migration safety net: if the column doesn't exist yet, fall back silently.
    if (err?.code === "42703") return REPLY_APPROVAL_CHANNEL;
    throw err;
  }
}

export const APPROVE_REACTIONS = new Set([
  "white_check_mark",
  "heavy_check_mark",
  "ballot_box_with_check",
  "+1",
  "thumbsup",
  "approved",
]);

export const EDIT_APPROVE_REACTIONS = new Set([
  "pencil",
  "pencil2",
  "writing_hand",
  "lower_left_ballpoint_pen",
]);

export const REJECT_REACTIONS = new Set([
  "x",
  "negative_squared_cross_mark",
  "no_entry",
  "-1",
  "thumbsdown",
  "rejected",
]);

/**
 * Strip em/en dashes and double-hyphens from email copy.
 * Replaces them with a comma + space so sentence flow stays natural.
 * Used after Claude returns drafted email bodies as a safety net.
 */
export function sanitizeDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, ", ")
    .replace(/\s+--\s+/g, ", ")
    .replace(/\s+-\s+/g, ", ");
}

/**
 * Guarantee a drafted email body ends with exactly one {SENDER_EMAIL_SIGNATURE}
 * variable and never a hand-written sign-off.
 *
 * EmailBison resolves {SENDER_EMAIL_SIGNATURE} to the sender's full signature at
 * send time. If the model also writes out a manual sign-off ("Best, / Lukas Maxen /
 * Head of Corporate Development, Larsen Digital"), the recipient gets two signatures.
 * This strips any trailing hand-written sign-off block and re-appends a single
 * variable, so the variable is the only sign-off regardless of prompt drift.
 */
export function normalizeSignature(body: string): string {
  // Drop every existing signature-variable token so we can re-append exactly one.
  let out = body.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trimEnd();

  // Strip a trailing manual sign-off: a closer line (Best, / Regards / Mvh / etc.)
  // followed by up to three short name/title lines at the very end of the body.
  const closer =
    /(?:^|\n)[^\S\n]*(?:best(?:\s+regards)?|kind\s+regards|warm\s+regards|regards|mvh|med\s+venlig\s+hilsen|venlig\s+hilsen|sincerely|cheers|all\s+the\s+best|thanks|thank\s+you)[,.]?[^\S\n]*(?:\n[^\S\n]*[^\n]{0,60}){0,3}\s*$/i;
  out = out.replace(closer, "").trimEnd();

  return `${out}\n\n{SENDER_EMAIL_SIGNATURE}`;
}

export function slugToName(slug: string): string {
  return slug
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function quoteForSlack(text: string, max = 2500): string {
  return text
    .slice(0, max)
    .split("\n")
    .map(line => `> ${line}`)
    .join("\n");
}

export function approvalFooterBlock(): object {
  return {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "Three options:  :white_check_mark: send the draft as-is  ·  :pencil2: regenerate with your feedback (write what to change in this thread first, then react :pencil2: , review the new version, react :white_check_mark: to send)  ·  :x: close out without sending (kills this reply or the entire FU sequence, nothing goes to the lead)",
      },
    ],
  };
}

/**
 * Verify a Slack request signature.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  rawBody: string,
  signature: string,
  timestamp: string
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !signature || !timestamp) return false;

  // Reject requests older than 5 minutes (replay protection).
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (Number.isNaN(ageSec) || ageSec > 60 * 5) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto
    .createHmac("sha256", secret)
    .update(baseString)
    .digest("hex")}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expected, "utf8")
    );
  } catch {
    return false;
  }
}

export interface SlackPostOptions {
  channel: string;
  blocks?: object[];
  text: string;
  threadTs?: string;
}

/**
 * Post a message to Slack via the bot token.
 * Returns the timestamp of the posted message, or null on failure.
 */
export async function postToSlack(opts: SlackPostOptions): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn("[slack] SLACK_BOT_TOKEN not set, skipping post to", opts.channel);
    return null;
  }

  const body: Record<string, unknown> = {
    channel: opts.channel,
    text: opts.text,
  };
  if (opts.blocks) body.blocks = opts.blocks;
  if (opts.threadTs) body.thread_ts = opts.threadTs;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") console.error("[slack] postMessage timed out after 10s, channel:", opts.channel);
    else console.error("[slack] postMessage fetch error:", err?.message);
    return null;
  } finally {
    clearTimeout(t);
  }
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    ts?: string;
    error?: string;
  };
  if (!data.ok) {
    console.error("[slack] post failed:", data.error, "channel:", opts.channel);
  }
  return data.ts ?? null;
}

/**
 * Add a reaction emoji to a message (used to confirm approve/reject/feedback received).
 * Logs the Slack error if the call fails so we can diagnose missing scopes.
 */
export async function addReaction(
  channel: string,
  ts: string,
  name: string
): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return false;
  const rCtrl = new AbortController();
  const rTimer = setTimeout(() => rCtrl.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, timestamp: ts, name }),
      signal: rCtrl.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") console.error(`[slack] reactions.add timed out after 10s for :${name}:`);
    else console.error(`[slack] reactions.add fetch error:`, err?.message);
    return false;
  } finally {
    clearTimeout(rTimer);
  }
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!data.ok) {
    console.error(
      `[slack] reactions.add failed for ${name} on ${ts} in ${channel}:`,
      data.error
    );
  }
  return data.ok === true;
}

/**
 * Deletes a Slack message posted by the bot (used to remove a stale approval
 * card once its reply has already been sent through another path, e.g. the
 * Larsen Digital full-auto bypass, so nobody reacts to a card for a message
 * that already went out). Silently no-ops if the message is already gone.
 */
export async function deleteSlackMessage(channel: string, ts: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return false;
  const dCtrl = new AbortController();
  const dTimer = setTimeout(() => dCtrl.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch("https://slack.com/api/chat.delete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, ts }),
      signal: dCtrl.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") console.error("[slack] chat.delete timed out after 10s, channel:", channel);
    else console.error("[slack] chat.delete fetch error:", err?.message);
    return false;
  } finally {
    clearTimeout(dTimer);
  }
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!data.ok && data.error !== "message_not_found") {
    console.error("[slack] chat.delete failed:", data.error, "channel:", channel, "ts:", ts);
  }
  return data.ok === true;
}

/**
 * Look up a Slack user's display name. Returns the user ID on failure.
 */
export async function getSlackUserName(userId: string): Promise<string> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return userId;
  const uCtrl = new AbortController();
  const uTimer = setTimeout(() => uCtrl.abort(), 10_000);
  try {
    const response = await fetch(
      `https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: uCtrl.signal }
    );
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      user?: { real_name?: string; name?: string };
    };
    return data.user?.real_name ?? data.user?.name ?? userId;
  } catch {
    return userId;
  } finally {
    clearTimeout(uTimer);
  }
}

// Channel ID -> name cache, populated lazily so we do not call conversations.info
// on every event. Channel renames are rare and a process restart picks them up.
const channelNameCache = new Map<string, string>();

/**
 * Resolve a Slack channel ID to its name (without #). Cached in process memory.
 * Returns the channel ID itself on failure.
 */
export async function getChannelName(channelId: string): Promise<string> {
  if (channelNameCache.has(channelId)) return channelNameCache.get(channelId)!;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return channelId;
  const cCtrl = new AbortController();
  const cTimer = setTimeout(() => cCtrl.abort(), 10_000);
  try {
    const response = await fetch(
      `https://slack.com/api/conversations.info?channel=${encodeURIComponent(channelId)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: cCtrl.signal }
    );
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      channel?: { name?: string };
    };
    const name = data.channel?.name ?? channelId;
    channelNameCache.set(channelId, name);
    return name;
  } catch {
    return channelId;
  } finally {
    clearTimeout(cTimer);
  }
}

/**
 * Strip the leading # from a configured channel name (eg "#feedback-review" -> "feedback-review").
 * Slack's conversations.info returns names without the #, so we compare on the bare name.
 */
export function bareChannelName(configuredName: string): string {
  return configuredName.replace(/^#/, "");
}

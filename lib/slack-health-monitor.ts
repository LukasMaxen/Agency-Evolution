import pool from "@/lib/db";
import { postToSlack, REPLY_APPROVAL_CHANNEL } from "@/lib/slack-approval";

// ── Slack health monitor ────────────────────────────────────────────────────
// Background watchdog for the approval-card pipeline. The failure it exists to
// catch: the deployed SLACK_BOT_TOKEN goes invalid (rotated / revoked on a
// deploy), every Slack post silently fails, and interested replies pile into
// status='awaiting_manual' with nobody watching. That ran for ~2 days on
// 2026-06-16..18 before anyone noticed, because the one channel that would have
// alerted us was the thing that was down.
//
// This check runs every 5 minutes from instrumentation.ts and:
//   1. Pings auth.test to detect a fully dead token.
//   2. Reads the DB for a spike in 'approval_card_post_failed' rows to detect a
//      channel-level failure (token works, one channel rejects).
//   3. On either signal, fires a throttled alert (webhook first so it survives a
//      dead bot token, then bot-token post, always a console breadcrumb).
//   4. Once Slack is healthy again, auto-reflows the stranded rows back to 'new'
//      in small batches so the sweeper reposts real approval cards.

// Workspaces excluded from auto-processing elsewhere; keep them out of the
// failure counts and the reflow so the monitor matches sweeper behaviour.
const EXCLUDED = ["itg-group", "sro-consulting"];

// Optional token-independent alert transport. A Slack incoming-webhook URL uses
// its own secret, NOT the bot token, so it still delivers when the bot token is
// dead (the exact case we most need to hear about). Set SLACK_ALERT_WEBHOOK_URL
// in the deployed env to make dead-token alerts reliable.
const ALERT_WEBHOOK = process.env.SLACK_ALERT_WEBHOOK_URL;

// Channel for the bot-token fallback alert. Defaults to a sibling of the
// approval channel; override with SLACK_ALERT_CHANNEL. Prefer a channel that is
// NOT the approval channel, so a channel-specific failure does not also swallow
// the alert.
const ALERT_CHANNEL = process.env.SLACK_ALERT_CHANNEL ?? REPLY_APPROVAL_CHANNEL;

// In-process throttle + state. Resets on container restart, which is fine: one
// re-alert after a restart during an ongoing outage is acceptable.
let lastAlertAt = 0;
let wasUnhealthy = false;
const ALERT_THROTTLE_MS = 60 * 60_000; // re-nag at most hourly while broken
const REFLOW_BATCH = 5; // small batches: limits damage if we misjudge "healthy"

let running = false;

interface AuthResult {
  ok: boolean;
  error?: string;
  // true only when Slack itself answered and rejected the token. false means
  // we never got a verdict (timeout, network error, 5xx, rate limit), which
  // says nothing about whether the token is valid.
  rejected?: boolean;
}

// Errors Slack returns when it reached a verdict on the token and said no.
// Anything else (timeouts, DNS, 5xx, ratelimited, service_unavailable) is a
// reachability problem, not a dead token.
const TOKEN_REJECTED = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "missing_scope",
  "no_permission",
  "org_login_required",
  "ekm_access_denied",
  "team_access_not_granted",
]);

async function pingAuthTest(token: string): Promise<AuthResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (data.ok === true) return { ok: true };
    const error = data.error ?? `http_${res.status}`;
    return { ok: false, error, rejected: TOKEN_REJECTED.has(error) };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.name === "AbortError" ? "auth_test_timeout" : err?.message,
      rejected: false,
    };
  } finally {
    clearTimeout(t);
  }
}

// A single failed auth.test can be a transient network blip on the host
// reaching slack.com, not a dead token. Retry once within the tick. A token
// Slack explicitly rejected is definitive and needs no retry.
async function checkToken(): Promise<AuthResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: "no_token_in_env", rejected: true };
  const first = await pingAuthTest(token);
  if (first.ok || first.rejected) return first;
  const retry = await pingAuthTest(token);
  return retry;
}

// Consecutive ticks where auth.test got no verdict from Slack. A back-to-back
// timeout pair inside one tick fired a false "pipeline DOWN" on 2026-10-08
// while cards were posting fine, so reachability failures only count as an
// outage once they persist across this many 5-minute ticks (15 minutes).
let unreachableTicks = 0;
const UNREACHABLE_TICKS_BEFORE_ALERT = 3;

// Best-effort alert. Tries the webhook (token-independent), then a bot-token
// post, and always logs. Returns true if any Slack transport accepted it.
async function sendAlert(text: string): Promise<boolean> {
  console.error(`[slack-health] ALERT: ${text.replace(/\n/g, " ")}`);
  let delivered = false;

  if (ALERT_WEBHOOK) {
    try {
      const res = await fetch(ALERT_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) delivered = true;
      else console.error("[slack-health] webhook alert failed, HTTP", res.status);
    } catch (err: any) {
      console.error("[slack-health] webhook alert error:", err?.message);
    }
  }

  // Bot-token fallback. Useless if the token itself is dead, but it is the right
  // path for a channel-level failure where the token still authenticates.
  const ts = await postToSlack({ channel: ALERT_CHANNEL, text });
  if (ts) delivered = true;

  return delivered;
}

export async function runSlackHealthCheck(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const auth = await checkToken();

    // Channel-level signal: interested replies parked at awaiting_manual by the
    // approval-card-post-failed fallthrough in the last 90 minutes.
    const recentFail = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM replies
        WHERE status = 'awaiting_manual'
          AND ai_analysis->>'skipped_reason' = 'approval_card_post_failed'
          AND received_at > NOW() - INTERVAL '90 minutes'
          AND workspace_slug <> ALL($1)`,
      [EXCLUDED]
    );
    const cardsFailing = (recentFail.rows[0]?.n ?? 0) > 0;
    const tokenDead = !auth.ok && auth.rejected === true;
    const unreachableNow = !auth.ok && !tokenDead;
    unreachableTicks = unreachableNow ? unreachableTicks + 1 : 0;
    const slackUnreachable = unreachableTicks >= UNREACHABLE_TICKS_BEFORE_ALERT;
    const unhealthy = tokenDead || slackUnreachable || cardsFailing;

    if (unreachableNow && !unhealthy) {
      // No verdict from Slack this tick and no failed cards. Not an outage
      // yet: log it, hold the reflow (posting may fail too), and re-check on
      // the next tick. Leaves wasUnhealthy alone so no recovery alert fires
      // for something we never alerted on.
      console.warn(
        `[slack-health] auth.test got no answer from Slack (${auth.error ?? "unknown"}), ` +
          `tick ${unreachableTicks}/${UNREACHABLE_TICKS_BEFORE_ALERT}, not alerting yet`
      );
      return;
    }

    if (unhealthy) {
      // Count the full stranded backlog (any age) for the alert body.
      const backlog = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM replies
          WHERE status = 'awaiting_manual'
            AND ai_analysis->>'skipped_reason' = 'approval_card_post_failed'
            AND workspace_slug <> ALL($1)`,
        [EXCLUDED]
      );
      const stranded = backlog.rows[0]?.n ?? 0;
      const now = Date.now();
      if (now - lastAlertAt > ALERT_THROTTLE_MS) {
        const cause = tokenDead
          ? `Slack rejected the deployed SLACK_BOT_TOKEN (auth.test: ${auth.error ?? "failed"}). Every Slack post is failing.`
          : slackUnreachable
            ? `The server has not been able to reach Slack for ${unreachableTicks * 5} minutes (auth.test: ${auth.error ?? "failed"}). The token itself may be fine; this is a network or Slack-side problem.`
            : `Approval cards are failing to post (channel-level). The bot token authenticates but the approval channel is rejecting posts.`;
        const fix = tokenDead
          ? `Fix the deployed Slack config in Coolify; the monitor auto-reflows the backlog once it recovers.`
          : slackUnreachable
            ? `Check the server's outbound network and status.slack.com; the monitor auto-reflows the backlog once it recovers.`
            : `Check the bot is still in the approval channel; the monitor auto-reflows the backlog once it recovers.`;
        await sendAlert(
          `:rotating_light: Approval-card pipeline DOWN.\n${cause}\n` +
            `${stranded} interested repl${stranded === 1 ? "y is" : "ies are"} stranded at awaiting_manual (not in any Slack channel). ` +
            fix
        );
        lastAlertAt = now;
      }
      wasUnhealthy = true;
      return;
    }

    // ── Healthy path ─────────────────────────────────────────────────────────
    // Reflow the Slack-stranded backlog back to 'new' so the sweeper reposts
    // real approval cards. auto_reply_processed_at MUST be nulled too: the
    // self-sweeper's main query filters on auto_reply_processed_at IS NULL, so
    // a row left with that timestamp set sits at 'new' forever and never gets
    // reprocessed. Small batch per tick: if we are wrong about being healthy
    // (channel still broken), only REFLOW_BATCH rows re-strand before the
    // cardsFailing signal trips again and stops us.
    const reflow = await pool.query<{ id: string; workspace_slug: string; lead_name: string }>(
      `UPDATE replies
          SET status = 'new',
              auto_reply_processed_at = NULL,
              processing_started_at = NULL,
              ai_analysis = (ai_analysis - 'slack_fail_count') - 'skipped_reason'
        WHERE id IN (
          SELECT id FROM replies
           WHERE status = 'awaiting_manual'
             AND ai_analysis->>'skipped_reason' = 'approval_card_post_failed'
             AND received_at > NOW() - INTERVAL '7 days'
             AND workspace_slug <> ALL($1)
           ORDER BY received_at ASC
           LIMIT ${REFLOW_BATCH}
        )
        RETURNING id, workspace_slug, lead_name`,
      [EXCLUDED]
    );

    if (reflow.rows.length > 0) {
      // Drop stale pending drafts so reprocessing does not leave duplicates.
      const ids = reflow.rows.map(r => r.id);
      await pool.query(
        `DELETE FROM reply_drafts WHERE reply_id = ANY($1) AND status = 'pending'`,
        [ids]
      );
      const who = reflow.rows.map(r => `${r.workspace_slug}/${r.lead_name}`).join(", ");
      console.log(`[slack-health] recovered: reflowed ${reflow.rows.length} stranded repl(y/ies) → new: ${who}`);
      if (wasUnhealthy) {
        await sendAlert(
          `:white_check_mark: Approval-card pipeline recovered. Reflowing ${reflow.rows.length} stranded repl${reflow.rows.length === 1 ? "y" : "ies"} this cycle; the sweeper will repost approval cards.`
        );
        wasUnhealthy = false;
      }
    } else if (wasUnhealthy) {
      // Recovered with nothing left to reflow.
      console.log("[slack-health] recovered: no stranded backlog remaining");
      wasUnhealthy = false;
    }
  } catch (err: any) {
    console.error("[slack-health] check failed:", err?.message ?? err);
  } finally {
    running = false;
  }
}

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
}

async function checkToken(): Promise<AuthResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: "no_token_in_env" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as AuthResult;
    return { ok: data.ok === true, error: data.error };
  } catch (err: any) {
    return { ok: false, error: err?.name === "AbortError" ? "auth_test_timeout" : err?.message };
  } finally {
    clearTimeout(t);
  }
}

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
    const tokenDead = !auth.ok;
    const unhealthy = tokenDead || cardsFailing;

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
          ? `Deployed SLACK_BOT_TOKEN is not authenticating (auth.test: ${auth.error ?? "failed"}). Every Slack post is failing.`
          : `Approval cards are failing to post (channel-level). The bot token authenticates but the approval channel is rejecting posts.`;
        await sendAlert(
          `:rotating_light: Approval-card pipeline DOWN.\n${cause}\n` +
            `${stranded} interested repl${stranded === 1 ? "y is" : "ies are"} stranded at awaiting_manual (not in any Slack channel). ` +
            `Fix the deployed Slack config in Coolify; the monitor auto-reflows the backlog once it recovers.`
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

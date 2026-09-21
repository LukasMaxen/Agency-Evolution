// Next.js 16 instrumentation hook. Runs once when the Node server boots.
// We use it to schedule in-process timers that replace the Coolify
// scheduled tasks (which kept failing because of host vs container shell,
// port mismatches, env var expansion, etc). Most call exported runner
// functions directly inside the Node process, no HTTP roundtrip needed.
//
//   1. Auto-reply self-sweeper      every 60 seconds
//   2. EmailBison inbox sync        every 2 minutes (catches untracked replies)
//   3. Follow-up processor          every 5 minutes
//   4. Weekly feedback review       hourly check, fires Mondays 08-11 UTC
//   5. Sender account sync          every 6 hours (keeps sender_accounts in
//                                   sync with EmailBison — removed senders
//                                   are deleted from DB and disappear from UI)
//   8. Sender daily stats sync      every 24 hours (per-sender Sent/Bounced/
//                                   Replied history cache for account monitor)
//   9. Sender warmup history sync   every 24 hours (per-sender 3/7/10/30d
//                                   warmup_score + prior-period cache)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Skip during build so a missing DATABASE_URL at build time doesn't crash.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // ── 1. Auto-reply self-sweeper ────────────────────────────────────────────
  const { runAutoReplySweep } = await import("@/lib/auto-reply-self-sweeper");

  setTimeout(() => {
    runAutoReplySweep().catch(err =>
      console.error("[instrumentation] initial reply self-sweep failed:", err)
    );
  }, 5_000);

  setInterval(() => {
    runAutoReplySweep().catch(err =>
      console.error("[instrumentation] periodic reply self-sweep failed:", err)
    );
  }, 60_000);

  console.log("[instrumentation] auto-reply self-sweeper started, 60s interval");

  // ── 2. EmailBison inbox sync ──────────────────────────────────────────────
  const { runEmailBisonInboxSync } = await import("@/lib/emailbison-inbox-sync");

  setTimeout(() => {
    runEmailBisonInboxSync().catch(err =>
      console.error("[instrumentation] initial inbox sync failed:", err)
    );
  }, 15_000);

  setInterval(() => {
    runEmailBisonInboxSync().catch(err =>
      console.error("[instrumentation] periodic inbox sync failed:", err)
    );
  }, 10 * 60_000);

  console.log("[instrumentation] EmailBison inbox sync started, 10min interval");

  // ── 3. Follow-up processor ────────────────────────────────────────────────
  // PAUSED 2026-05-14: Lukas disabled the FU sequence after generic non-personalised
  // bumps (and unresolved {SENDER_EMAIL_SIGNATURE} tokens) fired on replied leads.
  // Re-enable only after the drafter is fixed to match feedback-followup-sequence.md
  // and an approval queue is wired in (today the route auto-sends with no review).
  console.log("[instrumentation] follow-up processor DISABLED (paused 2026-05-14)");

  // ── 4. Feedback review ────────────────────────────────────────────────────
  // TEMPORARY (set 2026-05-28): running daily at ~14:00 UTC over the last 24h
  // of replies + feedback while Lukas validates the new Larsen rules. The
  // hour gate fires once per day in the 14-15 UTC window; the 23h dedupe
  // inside runWeeklyFeedbackReviewOnce prevents double-fires if the hourly
  // tick lands twice in the same window. Revert to weekly
  // (`d.getUTCDay() !== 1 || d.getUTCHours() < 8 || d.getUTCHours() >= 12`)
  // + 6-day dedupe + 7-day lookback once the cadence catches what we want.
  let wrRunning = false;
  const tryWeeklyReview = async () => {
    const d = new Date();
    if (d.getUTCHours() !== 14) return;
    if (wrRunning) return;
    wrRunning = true;
    try {
      const { runWeeklyFeedbackReviewOnce } = await import(
        "@/app/api/feedback/weekly-review/route"
      );
      const result = await runWeeklyFeedbackReviewOnce({ dedupeWindow: true });
      if (result.skipped) {
        console.log(`[instrumentation] weekly review skipped (${result.skipped})`);
      } else if (result.ok) {
        console.log(
          `[instrumentation] weekly review fired, feedback=${result.feedback_count} patterns=${result.patterns_found}`
        );
      } else if (result.error) {
        console.error(`[instrumentation] weekly review error: ${result.error}`);
      }
    } catch (err: any) {
      console.error("[instrumentation] weekly review failed:", err);
    } finally {
      wrRunning = false;
    }
  };

  setInterval(() => void tryWeeklyReview(), 60 * 60_000);
  setTimeout(() => void tryWeeklyReview(), 60_000);

  console.log("[instrumentation] weekly feedback review hourly check started");

  // ── 5. Sender account sync ────────────────────────────────────────────────
  // Fetches the full sender list from EmailBison for each workspace, upserts
  // into sender_accounts (status, warmup score, campaigns attached, limits) and
  // DELETES senders that no longer exist in EB. Runs every 15 minutes, ONE
  // WORKSPACE PER REQUEST, stalest first. A single all-workspaces request takes
  // minutes and is cut off by the proxy partway through, which left the last
  // few alphabetical workspaces frozen for days. Per-workspace requests finish
  // in seconds and never get cut off.
  const { postWorkspaceSync } = await import("@/lib/account-monitor-sync");
  let senderSyncRunning = false;
  const runSenderSync = async (label: string) => {
    if (senderSyncRunning) return;
    senderSyncRunning = true;
    try {
      const { default: pool } = await import("@/lib/db");
      const { rows } = await pool.query(
        `SELECT w.slug
           FROM workspaces w
           LEFT JOIN (SELECT workspace_slug, MAX(synced_at) AS last_synced
                        FROM sender_accounts GROUP BY workspace_slug) a
             ON a.workspace_slug = w.slug
          WHERE w.email_bison_api_key IS NOT NULL
          ORDER BY a.last_synced ASC NULLS FIRST`
      );
      let ok = 0, bad = 0;
      for (const { slug } of rows) {
        if (await postWorkspaceSync("/api/sync-sender-accounts", slug, { timeoutMs: 120_000 })) ok++;
        else { bad++; console.error(`[instrumentation] ${label} sender sync failed for ${slug}`); }
      }
      console.log(`[instrumentation] ${label} sender sync: ${ok}/${ok + bad} workspaces ok`);
    } catch (err: any) {
      console.error(`[instrumentation] ${label} sender sync failed:`, err);
    } finally {
      senderSyncRunning = false;
    }
  };

  setTimeout(() => void runSenderSync("initial"), 45_000);
  setInterval(() => void runSenderSync("periodic"), 15 * 60_000);

  console.log("[instrumentation] sender account sync started, per-workspace, 15min interval");

  // ── 6. Slack health monitor ───────────────────────────────────────────────
  // Watchdog for the approval-card pipeline. Detects a dead deployed bot token
  // (auth.test) or channel-level post failures, fires a throttled alert, and
  // auto-reflows stranded awaiting_manual rows once Slack recovers. Exists
  // because a dead token silently stranded interested replies for ~2 days on
  // 2026-06-16..18 with no alert (the alert channel itself was down).
  const { runSlackHealthCheck } = await import("@/lib/slack-health-monitor");

  setTimeout(() => {
    runSlackHealthCheck().catch(err =>
      console.error("[instrumentation] initial slack health check failed:", err)
    );
  }, 30_000);

  setInterval(() => {
    runSlackHealthCheck().catch(err =>
      console.error("[instrumentation] periodic slack health check failed:", err)
    );
  }, 5 * 60_000);

  console.log("[instrumentation] slack health monitor started, 5min interval");

  // ── 7. Larsen weekly outreach tracker ─────────────────────────────────────
  // Fills in last week's row block in the "Larsen Outreach Tracking" Google Sheet
  // (Emails Sent / Replies / Interested from EmailBison + our DB, Meetings Booked from
  // the calls table sourced live off the Calendly webhook). No Make, no Slack, no
  // Airtable in this pipeline — added 2026-08-06. Fires Mondays in the 07-09 UTC window
  // (covers 9am local across both CEST and CET) with a same-day dedupe since the hourly
  // tick can land more than once in that window. Re-running for the same week is safe
  // (idempotent overwrite of the same 4 rows), so the dedupe is just to avoid noise.
  let larsenWeeklyLastRunDate: string | null = null;
  const tryLarsenWeeklyReport = async () => {
    const d = new Date();
    if (d.getUTCDay() !== 1 || d.getUTCHours() < 7 || d.getUTCHours() >= 9) return;
    const todayKey = d.toISOString().slice(0, 10);
    if (larsenWeeklyLastRunDate === todayKey) return;
    larsenWeeklyLastRunDate = todayKey;
    try {
      const { runLarsenWeeklyReport } = await import("@/lib/reports/larsen-weekly");
      await runLarsenWeeklyReport();
      console.log("[instrumentation] Larsen weekly report fired");
    } catch (err: any) {
      console.error("[instrumentation] Larsen weekly report failed:", err);
    }
  };

  setInterval(() => void tryLarsenWeeklyReport(), 60 * 60_000);
  setTimeout(() => void tryLarsenWeeklyReport(), 90_000);

  console.log("[instrumentation] Larsen weekly outreach tracker hourly check started");

  // ── 8. Sender daily stats sync ────────────────────────────────────────────
  // Per-sender day-by-day Sent/Bounced/Replied/Interested history from EB's
  // /api/campaign-events/stats into sender_daily_stats. This is the single
  // source behind every number in every window (24h / 7d / 14d / 30d) of the
  // account monitor, so it has to be current.
  //
  // Every 10 minutes, one workspace per request, stalest first. Frequent runs
  // refetch only the last 3 days (fast, and only recent days can change); the
  // first run of each UTC day and the first run after boot refetch the full 32
  // days so any late correction in EB is picked up. The whole sweep takes about
  // 10 seconds, so running it this often is cheap.
  //
  // History: this used to be a single 24h timer, then a single request gated on
  // a global MAX(synced_at). Both let workspaces sit frozen for weeks: a
  // partial run made the global max look fresh, and one long request was cut
  // off by the proxy partway through the workspace list.
  let dailyStatsSyncRunning = false;
  let lastFullStatsDay = "";
  const runDailyStatsSync = async (label: string) => {
    if (dailyStatsSyncRunning) return;
    dailyStatsSyncRunning = true;
    try {
      const { default: pool } = await import("@/lib/db");
      const today = new Date().toISOString().slice(0, 10);
      const full = lastFullStatsDay !== today;
      const { rows } = await pool.query(
        `SELECT w.slug
           FROM workspaces w
           LEFT JOIN (SELECT workspace_slug, MAX(synced_at) AS last_synced
                        FROM sender_daily_stats GROUP BY workspace_slug) s
             ON s.workspace_slug = w.slug
          WHERE w.email_bison_api_key IS NOT NULL
            AND EXISTS (SELECT 1 FROM sender_accounts a WHERE a.workspace_slug = w.slug)
          ORDER BY s.last_synced ASC NULLS FIRST`
      );
      let ok = 0, bad = 0;
      for (const { slug } of rows) {
        if (await postWorkspaceSync("/api/sync-sender-daily-stats", slug, { lookback: full ? 32 : 3, timeoutMs: 90_000 })) ok++;
        else { bad++; console.error(`[instrumentation] ${label} daily stats sync failed for ${slug}`); }
      }
      if (bad === 0) lastFullStatsDay = today;
      console.log(`[instrumentation] ${label} daily stats sync (${full ? "full 32d" : "recent 3d"}): ${ok}/${ok + bad} workspaces ok`);
    } catch (err: any) {
      console.error(`[instrumentation] ${label} daily stats sync failed:`, err);
    } finally {
      dailyStatsSyncRunning = false;
    }
  };

  setTimeout(() => void runDailyStatsSync("initial"), 120_000);
  setInterval(() => void runDailyStatsSync("periodic"), 10 * 60_000);

  console.log("[instrumentation] sender daily stats sync started, per-workspace, 10min interval");

  // ── 9. Sender warmup history sync ─────────────────────────────────────────
  // Current + prior 3/7/10/30-day warmup_score windows per sender from EB into
  // sender_warmup_periods, for the trend delta on the account monitor. 8 EB
  // calls per sender, so it is the heaviest job: checked every 30 minutes, but
  // only workspaces older than WARMUP_MAX_AGE_HOURS are synced, one workspace
  // per request, stalest first, so a run that gets interrupted still leaves
  // the stalest workspaces closest to done. (The current warmup score itself
  // comes from job 5, every 15 minutes.)
  const { WARMUP_MAX_AGE_HOURS } = await import("@/lib/account-monitor-sync");
  let warmupHistorySyncRunning = false;
  const runWarmupHistorySync = async (label: string) => {
    if (warmupHistorySyncRunning) return;
    warmupHistorySyncRunning = true;
    try {
      const { default: pool } = await import("@/lib/db");
      const { rows } = await pool.query(
        `SELECT a.workspace_slug AS slug
           FROM (SELECT DISTINCT workspace_slug FROM sender_accounts WHERE warmup_score > 0) a
           LEFT JOIN (SELECT workspace_slug, MAX(synced_at) AS last_synced
                        FROM sender_warmup_periods GROUP BY workspace_slug) s
             USING (workspace_slug)
          WHERE s.last_synced IS NULL
             OR s.last_synced < NOW() - ($1 || ' hours')::interval
          ORDER BY s.last_synced ASC NULLS FIRST`,
        [WARMUP_MAX_AGE_HOURS]
      );
      if (rows.length === 0) return;
      let ok = 0, bad = 0;
      for (const { slug } of rows) {
        if (await postWorkspaceSync("/api/sync-sender-warmup-history", slug, { timeoutMs: 120_000 })) ok++;
        else { bad++; console.error(`[instrumentation] ${label} warmup history sync failed for ${slug}`); }
      }
      console.log(`[instrumentation] ${label} warmup history sync: ${ok}/${ok + bad} workspaces ok`);
    } catch (err: any) {
      console.error(`[instrumentation] ${label} warmup history sync failed:`, err);
    } finally {
      warmupHistorySyncRunning = false;
    }
  };

  setTimeout(() => void runWarmupHistorySync("initial"), 240_000);
  setInterval(() => void runWarmupHistorySync("periodic"), 30 * 60_000);

  console.log("[instrumentation] sender warmup history sync started, per-workspace, staleness-checked every 30min");

  // ── 10. Fillout cancellation sweep ────────────────────────────────────────
  // Fillout (WithPebble's booking tool) has no cancellation webhook — see
  // lib/fillout-cancellation-sweep.ts. Polls GET /forms/{formId}/submissions and diffs
  // against `calls` rows still status='scheduled' to catch cancellations after the fact.
  const { sweepFilloutCancellations } = await import("@/lib/fillout-cancellation-sweep");

  setTimeout(() => {
    sweepFilloutCancellations().catch(err =>
      console.error("[instrumentation] initial fillout cancellation sweep failed:", err)
    );
  }, 60_000);

  setInterval(() => {
    sweepFilloutCancellations().catch(err =>
      console.error("[instrumentation] periodic fillout cancellation sweep failed:", err)
    );
  }, 15 * 60_000);

  console.log("[instrumentation] fillout cancellation sweep started, 15min interval");
}
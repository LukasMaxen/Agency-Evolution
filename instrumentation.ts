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
  // Fetches the full sender email list from EmailBison for every workspace,
  // upserts into sender_accounts, and DELETES senders that no longer exist
  // in EB. This keeps the Account Monitor in sync automatically — senders
  // removed from EmailBison disappear from the UI after the next sync.
  let senderSyncRunning = false;
  const runSenderSync = async (label: string) => {
    if (senderSyncRunning) return;
    senderSyncRunning = true;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/sync-sender-accounts`, { method: "POST" });
      if (!res.ok) {
        const err = await res.text();
        console.error(`[instrumentation] ${label} sender sync HTTP error:`, err);
        return;
      }
      const data = await res.json();
      console.log(
        `[instrumentation] ${label} sender sync: ` +
        `+${data.totalAdded} added, -${data.totalRemoved} removed, ` +
        `${data.synced}/${data.synced + data.failed} workspaces ok`
      );
    } catch (err: any) {
      console.error(`[instrumentation] ${label} sender sync failed:`, err);
    } finally {
      senderSyncRunning = false;
    }
  };

  // Run once 45s after boot (let other timers settle first), then every 1h
  setTimeout(() => void runSenderSync("initial"), 45_000);
  setInterval(() => void runSenderSync("periodic"), 60 * 60_000);

  console.log("[instrumentation] sender account sync started, 1h interval");

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
  // Pulls each sender's real day-by-day Sent/Bounced/Replied history from
  // EB's /api/campaign-events/stats into sender_daily_stats, which the
  // account monitor dashboard reads instead of calling EB live on every
  // page load (a full sweep at per-sender granularity takes ~50s, fine
  // once a day, far too slow for a request). Added 2026-08-06 after the
  // EMAIL_SENT webhook outage (see app/api/webhook/[workspace]/route.ts)
  // showed the dashboard's old approach -- local tables fed only by that
  // webhook -- had no safety net when EB stopped delivering it.
  //
  // FIXED 2026-09-14: this used to be a single setTimeout 2min after boot
  // plus a blind setInterval(24h). Coolify redeploys more often than every
  // 24h (auto-sync commits land daily or more), which kills the process
  // before the 24h interval ever gets a chance to fire -- the ONE boot-time
  // attempt was the only shot this job ever got. When that one attempt hit
  // any transient failure the cache went stale with no retry until the next
  // redeploy, which hit the same fate. Result: sender_daily_stats and
  // sender_warmup_periods silently froze at 2026-08-21 for 3+ weeks and the
  // account monitor served stale sent/bounce/reply/warmup-trend numbers for
  // any 14d/30d window without any error or indication. Fixed the same way
  // job #5 (sender account sync) already self-heals: check the DB for how
  // stale the cache actually is on a short poll interval, and only pay for
  // the heavy EB sweep when it's actually due. This makes correctness
  // depend on DB state, not on the container surviving 24h uninterrupted.
  const DAILY_STATS_STALE_HOURS = 20;
  let dailyStatsSyncRunning = false;
  let lastDailyStatsAttempt = 0;
  const runDailyStatsSync = async (label: string) => {
    if (dailyStatsSyncRunning) return;
    dailyStatsSyncRunning = true;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/sync-sender-daily-stats`, { method: "POST" });
      if (!res.ok) {
        const err = await res.text();
        console.error(`[instrumentation] ${label} sender daily stats sync HTTP error:`, err);
        return;
      }
      const data = await res.json();
      console.log(
        `[instrumentation] ${label} sender daily stats sync: ` +
        `${data.synced}/${data.synced + data.failed} workspaces ok`
      );
    } catch (err: any) {
      console.error(`[instrumentation] ${label} sender daily stats sync failed:`, err);
    } finally {
      dailyStatsSyncRunning = false;
    }
  };
  const tryDailyStatsSync = async (label: string) => {
    try {
      const { default: pool } = await import("@/lib/db");
      // Staleness = the STALEST workspace, not the global MAX. A global MAX
      // let one partial or single-workspace run (a manual sync, the UI Sync
      // button, a run that died mid-way) mark every other workspace fresh,
      // which is how most workspaces sat frozen for weeks. Workspaces with
      // no cache rows at all count as stale.
      const { rows } = await pool.query(
        `SELECT MIN(COALESCE(s.last_synced, 'epoch'::timestamptz)) AS last_synced
           FROM (SELECT DISTINCT workspace_slug FROM sender_accounts) a
           LEFT JOIN (SELECT workspace_slug, MAX(synced_at) AS last_synced
                        FROM sender_daily_stats GROUP BY workspace_slug) s
             USING (workspace_slug)`
      );
      const lastSynced = rows[0]?.last_synced ? new Date(rows[0].last_synced).getTime() : 0;
      if (Date.now() - lastSynced < DAILY_STATS_STALE_HOURS * 60 * 60_000) return;
      // Cooldown so a workspace that can never produce rows doesn't
      // retrigger the full sweep every 30 minutes.
      if (Date.now() - lastDailyStatsAttempt < 3 * 60 * 60_000) return;
    } catch (err: any) {
      console.error("[instrumentation] daily stats staleness check failed, attempting sync anyway:", err);
    }
    lastDailyStatsAttempt = Date.now();
    await runDailyStatsSync(label);
  };

  // Check every 30min (cheap: one MAX() query) but only actually run the
  // heavy EB sweep once the cache is >20h old, so it survives redeploys
  // that land more often than once a day.
  setTimeout(() => void tryDailyStatsSync("initial"), 120_000);
  setInterval(() => void tryDailyStatsSync("periodic"), 30 * 60_000);

  console.log("[instrumentation] sender daily stats sync started, staleness-checked every 30min (>20h triggers a real sync)");

  // ── 9. Sender warmup history sync ─────────────────────────────────────────
  // Pulls current + prior 3/7/10/30-day warmup_score windows per sender
  // from EB into sender_warmup_periods, so the account monitor can show a
  // trend delta (e.g. "+2.1" or "-3.4") without any live EB calls at read
  // time. 8 EB calls per sender (4 periods x current+prior), so staggered
  // even later than the daily stats sync to avoid piling both heavy jobs
  // on top of each other right at boot.
  //
  // FIXED 2026-09-14: same staleness-checked pattern as job #8 above, same
  // reason -- see that comment. This table froze on the same date (2026-08-21)
  // for the same root cause.
  const WARMUP_HISTORY_STALE_HOURS = 20;
  let warmupHistorySyncRunning = false;
  let lastWarmupHistoryAttempt = 0;
  const runWarmupHistorySync = async (label: string) => {
    if (warmupHistorySyncRunning) return;
    warmupHistorySyncRunning = true;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/sync-sender-warmup-history`, { method: "POST" });
      if (!res.ok) {
        const err = await res.text();
        console.error(`[instrumentation] ${label} warmup history sync HTTP error:`, err);
        return;
      }
      const data = await res.json();
      console.log(
        `[instrumentation] ${label} warmup history sync: ` +
        `${data.synced}/${data.synced + data.failed} workspaces ok`
      );
    } catch (err: any) {
      console.error(`[instrumentation] ${label} warmup history sync failed:`, err);
    } finally {
      warmupHistorySyncRunning = false;
    }
  };
  const tryWarmupHistorySync = async (label: string) => {
    try {
      const { default: pool } = await import("@/lib/db");
      // Same stalest-workspace rule as the daily stats job. Only workspaces
      // that actually have a scored sender count, since the sync skips
      // senders with no score and would otherwise look stale forever.
      const { rows } = await pool.query(
        `SELECT MIN(COALESCE(s.last_synced, 'epoch'::timestamptz)) AS last_synced
           FROM (SELECT DISTINCT workspace_slug FROM sender_accounts WHERE warmup_score > 0) a
           LEFT JOIN (SELECT workspace_slug, MAX(synced_at) AS last_synced
                        FROM sender_warmup_periods GROUP BY workspace_slug) s
             USING (workspace_slug)`
      );
      const lastSynced = rows[0]?.last_synced ? new Date(rows[0].last_synced).getTime() : 0;
      if (Date.now() - lastSynced < WARMUP_HISTORY_STALE_HOURS * 60 * 60_000) return;
      if (Date.now() - lastWarmupHistoryAttempt < 6 * 60 * 60_000) return;
    } catch (err: any) {
      console.error("[instrumentation] warmup history staleness check failed, attempting sync anyway:", err);
    }
    lastWarmupHistoryAttempt = Date.now();
    await runWarmupHistorySync(label);
  };

  setTimeout(() => void tryWarmupHistorySync("initial"), 240_000);
  setInterval(() => void tryWarmupHistorySync("periodic"), 30 * 60_000);

  console.log("[instrumentation] sender warmup history sync started, staleness-checked every 30min (>20h triggers a real sync)");

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
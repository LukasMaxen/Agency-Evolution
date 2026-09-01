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
  let dailyStatsSyncRunning = false;
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

  // Run once 2min after boot (it's the heaviest job, let the fast timers
  // settle first), then once every 24h.
  setTimeout(() => void runDailyStatsSync("initial"), 120_000);
  setInterval(() => void runDailyStatsSync("periodic"), 24 * 60 * 60_000);

  console.log("[instrumentation] sender daily stats sync started, 24h interval");

  // ── 9. Sender warmup history sync ─────────────────────────────────────────
  // Pulls current + prior 3/7/10/30-day warmup_score windows per sender
  // from EB into sender_warmup_periods, so the account monitor can show a
  // trend delta (e.g. "+2.1" or "-3.4") without any live EB calls at read
  // time. 8 EB calls per sender (4 periods x current+prior), so staggered
  // even later than the daily stats sync to avoid piling both heavy jobs
  // on top of each other right at boot.
  let warmupHistorySyncRunning = false;
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

  setTimeout(() => void runWarmupHistorySync("initial"), 240_000);
  setInterval(() => void runWarmupHistorySync("periodic"), 24 * 60 * 60_000);

  console.log("[instrumentation] sender warmup history sync started, 24h interval");

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
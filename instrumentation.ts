// Next.js 16 instrumentation hook. Runs once when the Node server boots.
// We use it to schedule five in-process timers that replace the Coolify
// scheduled tasks (which kept failing because of host vs container shell,
// port mismatches, env var expansion, etc). All five call exported runner
// functions directly inside the Node process, no HTTP roundtrip needed.
//
//   1. Auto-reply self-sweeper      every 60 seconds
//   2. EmailBison inbox sync        every 2 minutes (catches untracked replies)
//   3. Follow-up processor          every 5 minutes
//   4. Weekly feedback review       hourly check, fires Mondays 08-11 UTC
//   5. Sender account sync          every 6 hours (keeps sender_accounts in
//                                   sync with EmailBison — removed senders
//                                   are deleted from DB and disappear from UI)
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
}
// Next.js 16 instrumentation hook. Runs once when the Node server boots.
// We use it to schedule four in-process timers that replace the Coolify
// scheduled tasks (which kept failing because of host vs container shell,
// port mismatches, env var expansion, etc). All four call exported runner
// functions directly inside the Node process, no HTTP roundtrip needed.
//
//   1. Auto-reply self-sweeper      every 60 seconds
//   2. EmailBison inbox sync        every 2 minutes (catches untracked replies)
//   3. Follow-up processor          every 5 minutes
//   4. Weekly feedback review       hourly check, fires Mondays 08-11 UTC
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
  // Polls each workspace's inbox to catch replies the LEAD_REPLIED webhook
  // misses. Most importantly, untracked replies (sent directly to a sender
  // mailbox, not in response to a campaign send) — EmailBison never fires
  // LEAD_REPLIED for those, so polling is the only way to see them.
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
  }, 2 * 60_000);

  console.log("[instrumentation] EmailBison inbox sync started, 2min interval");

  // ── 3. Follow-up processor ────────────────────────────────────────────────
  let fuRunning = false;
  const runFu = async (label: string) => {
    if (fuRunning) return;
    fuRunning = true;
    try {
      const { runFollowUpProcessorOnce } = await import(
        "@/app/api/follow-ups/process/route"
      );
      const result = await runFollowUpProcessorOnce();
      if (result.processed > 0) {
        console.log(
          `[instrumentation] ${label} FU processor processed ${result.processed} due follow-ups`
        );
      }
    } catch (err: any) {
      console.error(`[instrumentation] ${label} FU processor failed:`, err);
    } finally {
      fuRunning = false;
    }
  };

  setTimeout(() => void runFu("initial"), 30_000);
  setInterval(() => void runFu("periodic"), 5 * 60_000);

  console.log("[instrumentation] follow-up processor started, 5min interval");

  // ── 4. Weekly feedback review ─────────────────────────────────────────────
  // Hourly check. Only fires inside the Monday 08-11 UTC window AND only if
  // no weekly_reviews row exists in the last 6 days (dedupe handled inside
  // the runner). Worst case: app restarts mid-window, dedupe ensures we
  // never post twice.
  let wrRunning = false;
  const tryWeeklyReview = async () => {
    const d = new Date();
    if (d.getUTCDay() !== 1 || d.getUTCHours() < 8 || d.getUTCHours() >= 12) return;
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
  // Also check 60s after boot so a fresh deploy on Monday morning still fires.
  setTimeout(() => void tryWeeklyReview(), 60_000);

  console.log("[instrumentation] weekly feedback review hourly check started");
}

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
  // Two paths for resilience:
  // A) In-process: calls runAutoReplySweep() directly inside the Node process
  // B) HTTP self-ping: hits the open sweep endpoint every 90s as a fallback
  //    in case the in-process function has issues or the running flag is stuck.
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

  // HTTP self-ping fallback for reply sweep — runs every 90s.
  // Uses localhost first, falls back to external URL.
  const port = process.env.PORT || "3000";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://inbox.agencyevolution.eu";

  setInterval(() => {
    fetch(`http://localhost:${port}/api/auto-reply/sweep?limit=20`)
      .then(r => r.json())
      .then(d => { if (d.processed_ok > 0) console.log(`[instrumentation] HTTP sweep: ${d.processed_ok} processed`); })
      .catch(() => {
        fetch(`${appUrl}/api/auto-reply/sweep?limit=20`)
          .then(r => r.json())
          .then(d => { if (d.processed_ok > 0) console.log(`[instrumentation] HTTP sweep (ext): ${d.processed_ok} processed`); })
          .catch(err => console.error("[instrumentation] HTTP sweep ping failed:", err));
      });
  }, 90_000);

  // HTTP self-ping fallback for follow-up processor — runs every 120s.
  setInterval(() => {
    fetch(`http://localhost:${port}/api/follow-ups/process`, { method: "POST" })
      .then(r => r.json())
      .then(d => { if (d.processed > 0) console.log(`[instrumentation] HTTP FU: ${d.processed} processed`); })
      .catch(() => {
        fetch(`${appUrl}/api/follow-ups/process`, { method: "POST" })
          .then(r => r.json())
          .then(d => { if (d.processed > 0) console.log(`[instrumentation] HTTP FU (ext): ${d.processed} processed`); })
          .catch(err => console.error("[instrumentation] HTTP FU ping failed:", err));
      });
  }, 120_000);

  console.log("[instrumentation] auto-reply self-sweeper started (60s in-process + 90s HTTP fallback)");

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

  // Run once 45s after boot (let other timers settle first), then every 6h
  setTimeout(() => void runSenderSync("initial"), 45_000);
  setInterval(() => void runSenderSync("periodic"), 6 * 60 * 60_000);

  console.log("[instrumentation] sender account sync started, 6h interval");
}
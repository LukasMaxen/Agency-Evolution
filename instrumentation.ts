// Next.js 16 instrumentation hook. Runs once when the Node server boots.
// We use it to start an in-process safety-net sweeper that picks up any
// replies stuck at status='new' (eg if the webhook's after() handler dropped
// the work) and processes them. This eliminates the dependency on an
// external cron and works regardless of container networking / ports.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Skip during build so a missing DATABASE_URL at build time doesn't crash.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { runAutoReplySweep } = await import("@/lib/auto-reply-self-sweeper");

  // Kick once shortly after boot to flush anything the previous instance left.
  setTimeout(() => {
    runAutoReplySweep().catch(err =>
      console.error("[instrumentation] initial self-sweep failed:", err)
    );
  }, 5_000);

  // Then run every 60 seconds.
  setInterval(() => {
    runAutoReplySweep().catch(err =>
      console.error("[instrumentation] periodic self-sweep failed:", err)
    );
  }, 60_000);

  console.log("[instrumentation] auto-reply self-sweeper started, 60s interval");
}

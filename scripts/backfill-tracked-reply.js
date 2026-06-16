// Backfill replies.reply_type / replies.tracked_reply from EmailBison.
//
// Walks /api/replies for each workspace and UPDATEs rows by id (uuid).
// Bounded to ~35 days of recent inbox history; older rows stay NULL and are
// excluded from the dashboard's reply-rate KPI by construction (the
// account-monitor query already windows to 3/10/30 days).
//
// Run after migration 013 has been applied:
//   node scripts/backfill-tracked-reply.js
//   node scripts/backfill-tracked-reply.js gn-motion       # single workspace
//
// Resilience:
//   - Per-workspace error isolation (one workspace failing does not stop the
//     others).
//   - Fetch retries with exponential backoff on transient EB errors.
//   - DB pool is small (2) and idle connections recycle, so a long-running
//     walk does not exhaust upstream.

const { Pool } = require("pg");
const fs = require("fs");

const envPath = `${process.cwd()}/.env.local`;
const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8").split("\n")
    .filter(l => l.includes("="))
    .map(l => {
      const i = l.indexOf("=");
      const k = l.slice(0, i).trim();
      const v = l.slice(i + 1).trim().replace(/^"|"$/g, "");
      return [k, v];
    })
);

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: false,
  max: 20,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 8000,
});

const EB_PAGE_SIZE = 15;              // EB caps page size at 15 regardless of per_page
const MAX_PAGES_PER_WORKSPACE = 300;  // 300 * 15 = 4500 rows cap per workspace
const MAX_AGE_DAYS = 35;
const FETCH_TIMEOUT_MS = 15000;
const FETCH_RETRIES = 3;

async function fetchWithRetry(url, headers) {
  let lastErr;
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { headers, signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) {
        lastErr = new Error(`HTTP ${r.status}`);
        if (r.status >= 500) continue;
        return null;
      }
      return await r.json();
    } catch (err) {
      clearTimeout(to);
      lastErr = err;
    }
  }
  throw lastErr;
}

async function backfillWorkspace(ws) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let updated = 0, skipped = 0, stopReason = "exhausted";

  for (let page = 1; page <= MAX_PAGES_PER_WORKSPACE; page++) {
    const url = `${ws.email_bison_instance_url}/api/replies?per_page=250&page=${page}`;
    let body;
    try {
      body = await fetchWithRetry(url, {
        Authorization: `Bearer ${ws.email_bison_api_key}`,
      });
    } catch (err) {
      console.error(`  [${ws.slug}] page ${page} fetch error (giving up workspace):`, err.message);
      stopReason = "fetch_error";
      break;
    }
    if (!body) { stopReason = "auth_or_404"; break; }
    const items = body?.data ?? [];
    if (items.length === 0) { stopReason = "no_data"; break; }

    let stoppedOnCutoff = false;
    for (const item of items) {
      if (!item.uuid) continue;
      const t = new Date(item.date_received).getTime();
      if (t < cutoff) { stoppedOnCutoff = true; continue; }

      const isTracked =
        typeof item.tracked_reply === "boolean"
          ? item.tracked_reply
          : item.type === "Tracked Reply";

      try {
        const res = await pool.query(
          `UPDATE replies
             SET reply_type    = $1,
                 tracked_reply = $2
           WHERE id = $3
             AND (reply_type IS DISTINCT FROM $1 OR tracked_reply IS DISTINCT FROM $2)`,
          [item.type ?? null, isTracked, item.uuid]
        );
        if (res.rowCount && res.rowCount > 0) updated++; else skipped++;
      } catch (err) {
        console.error(`  [${ws.slug}] UPDATE failed for ${item.uuid}:`, err.message);
      }
    }

    if (stoppedOnCutoff) { stopReason = "cutoff"; break; }
    if (items.length < EB_PAGE_SIZE) { stopReason = "last_page"; break; }
  }

  console.log(`  [${ws.slug}] updated=${updated} skipped=${skipped} stop=${stopReason}`);
  return { updated, skipped };
}

(async () => {
  const targetSlug = process.argv[2] || null;
  const filter = targetSlug ? "AND slug = $1" : "";
  const wss = await pool.query(
    `SELECT slug, email_bison_api_key, email_bison_instance_url
       FROM workspaces
      WHERE email_bison_api_key IS NOT NULL
        AND email_bison_instance_url IS NOT NULL
        ${filter}
      ORDER BY slug`,
    targetSlug ? [targetSlug] : []
  );

  console.log(`Backfilling tracked_reply for ${wss.rows.length} workspaces in parallel${targetSlug ? ` (filter=${targetSlug})` : ""}...`);
  const results = await Promise.all(wss.rows.map(async ws => {
    try {
      return await backfillWorkspace(ws);
    } catch (err) {
      console.error(`  [${ws.slug}] aborted with error:`, err.message);
      return { updated: 0, skipped: 0 };
    }
  }));
  const total = results.reduce((s, r) => s + (r.updated || 0), 0);

  const stats = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE tracked_reply IS NULL)        AS null_rows,
      COUNT(*) FILTER (WHERE tracked_reply = TRUE)         AS tracked,
      COUNT(*) FILTER (WHERE tracked_reply = FALSE)        AS untracked,
      COUNT(*)                                              AS total
    FROM replies
    WHERE received_at >= NOW() - INTERVAL '30 days'
  `);
  console.log("\nLast-30-day reply rows after backfill:");
  console.log(stats.rows[0]);
  console.log(`\nTotal UPDATEs across all workspaces: ${total}`);

  await pool.end();
})().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

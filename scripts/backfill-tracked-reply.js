// Backfill replies.reply_type / replies.tracked_reply from EmailBison.
//
// Walks /api/replies for each workspace and UPDATEs rows by id (uuid).
// Bounded to ~30 days of recent inbox history; older rows stay NULL and are
// excluded from the dashboard's reply-rate KPI by construction (the
// account-monitor query already windows to 3/10/30 days).
//
// Run after migration 013 has been applied:
//   node scripts/backfill-tracked-reply.js
//
// Idempotent: safe to re-run. UPDATEs are no-ops if the value is unchanged.

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

const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: false });

const MAX_PAGES_PER_WORKSPACE = 40;   // 40 * 250 = 10k rows per workspace cap
const MAX_AGE_DAYS = 35;              // walk back ~35 days, dashboard caps at 30

async function backfillWorkspace(ws) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let updated = 0;
  let skipped = 0;
  let stoppedOnCutoff = false;

  for (let page = 1; page <= MAX_PAGES_PER_WORKSPACE; page++) {
    const url = `${ws.email_bison_instance_url}/api/replies?per_page=250&page=${page}`;
    let body;
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${ws.email_bison_api_key}` },
      });
      if (!r.ok) {
        console.error(`  [${ws.slug}] page ${page} fetch failed: ${r.status}`);
        break;
      }
      body = await r.json();
    } catch (err) {
      console.error(`  [${ws.slug}] page ${page} fetch threw:`, err.message);
      break;
    }

    const items = body?.data ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      if (!item.uuid) continue;
      const receivedAt = new Date(item.date_received).getTime();
      if (receivedAt < cutoff) {
        stoppedOnCutoff = true;
        continue;
      }

      const isTracked =
        typeof item.tracked_reply === "boolean"
          ? item.tracked_reply
          : item.type === "Tracked Reply";

      const res = await pool.query(
        `UPDATE replies
           SET reply_type    = $1,
               tracked_reply = $2
         WHERE id = $3
           AND (reply_type IS DISTINCT FROM $1 OR tracked_reply IS DISTINCT FROM $2)`,
        [item.type ?? null, isTracked, item.uuid]
      );
      if (res.rowCount && res.rowCount > 0) updated++;
      else skipped++;
    }

    if (stoppedOnCutoff) break;
    if (items.length < 250) break;
  }

  console.log(`  [${ws.slug}] updated=${updated} skipped=${skipped}`);
  return { updated, skipped };
}

(async () => {
  const wss = await pool.query(`
    SELECT slug, email_bison_api_key, email_bison_instance_url
    FROM workspaces
    WHERE email_bison_api_key IS NOT NULL
      AND email_bison_instance_url IS NOT NULL
    ORDER BY slug
  `);

  console.log(`Backfilling tracked_reply for ${wss.rows.length} workspaces...`);
  let total = 0;
  for (const ws of wss.rows) {
    const r = await backfillWorkspace(ws);
    total += r.updated;
  }

  // Final stats
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

// Fast warmup-score backfill. Walks /api/warmup/sender-emails per workspace
// in parallel and UPDATEs sender_accounts.warmup_score (and refreshes
// warmup_enabled from the same source). Skips the campaign-walk that the
// full sync does, so it finishes in ~30-60s instead of 10+ minutes.
//
// Run:
//   node scripts/sync-warmup-scores.js
//   node scripts/sync-warmup-scores.js gn-motion
//
// Idempotent.

const { Pool } = require("pg");
const fs = require("fs");

const env = Object.fromEntries(
  fs.readFileSync(`${process.cwd()}/.env.local`, "utf8").split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: false,
  max: 20,
  idleTimeoutMillis: 10000,
});

const MAX_PAGES = 50;       // 50 * 15 = 750 senders cap per workspace
const FETCH_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, headers) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    clearTimeout(to);
    return r;
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

async function syncWorkspace(ws) {
  let page = 1;
  let scored = 0;
  let scannedRows = 0;
  while (page <= MAX_PAGES) {
    let body;
    try {
      const r = await fetchWithTimeout(
        `${ws.url}/api/warmup/sender-emails?per_page=250&page=${page}`,
        { Authorization: `Bearer ${ws.key}`, Accept: "application/json" }
      );
      if (!r.ok) { console.error(`  [${ws.slug}] page ${page} ${r.status}`); break; }
      body = await r.json();
    } catch (err) {
      console.error(`  [${ws.slug}] page ${page} fetch threw: ${err.message}`);
      break;
    }
    const rows = body?.data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row?.id) continue;
      scannedRows++;
      const score = typeof row.warmup_score === "number" ? row.warmup_score : null;
      const enabled = row.warmup_enabled === true;
      const res = await pool.query(
        `UPDATE sender_accounts
           SET warmup_score = $1, warmup_enabled = $2
         WHERE workspace_slug = $3 AND eb_sender_id = $4`,
        [score, enabled, ws.slug, row.id]
      );
      if (res.rowCount && res.rowCount > 0 && score !== null) scored++;
    }

    const last = body?.meta?.last_page ?? page;
    if (page >= last) break;
    if (rows.length < 15) break;
    page++;
  }
  console.log(`  [${ws.slug}] scored=${scored} scanned=${scannedRows} pages=${page}`);
  return { scored, scannedRows };
}

(async () => {
  const targetSlug = process.argv[2] || null;
  const wss = await pool.query(
    `SELECT slug, email_bison_api_key AS key, email_bison_instance_url AS url
       FROM workspaces
      WHERE email_bison_api_key IS NOT NULL
        AND email_bison_instance_url IS NOT NULL
        ${targetSlug ? "AND slug = $1" : ""}
      ORDER BY slug`,
    targetSlug ? [targetSlug] : []
  );

  console.log(`Syncing warmup scores for ${wss.rows.length} workspaces in parallel...`);
  const t0 = Date.now();
  const results = await Promise.all(wss.rows.map(async ws => {
    try { return await syncWorkspace(ws); }
    catch (e) { console.error(`  [${ws.slug}] aborted: ${e.message}`); return { scored: 0 }; }
  }));
  const total = results.reduce((s, r) => s + (r.scored || 0), 0);
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s. ${total} senders scored.`);

  const summary = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE warmup_score IS NULL) AS null_score,
      COUNT(*) FILTER (WHERE warmup_score IS NOT NULL) AS scored,
      COUNT(*) AS total
    FROM sender_accounts
  `);
  console.log("\nGlobal:", summary.rows[0]);

  await pool.end();
})().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});

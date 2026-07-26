/**
 * Backfill today's stuck replies through processAutoReply.
 *
 * Picks every reply with status='new' received in the last 24h, runs the
 * full Haiku-classify -> Sonnet-draft (or template) flow, and posts approval
 * cards to #reply-approval. Idempotent (atomic claim), safe to re-run.
 *
 * Defaults to DRY-RUN, prints what it would process. Pass --send to actually run.
 *
 *   npx tsx scripts/backfill-stuck-replies-today.ts            # dry run
 *   npx tsx scripts/backfill-stuck-replies-today.ts --send     # live
 */
import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const SEND = process.argv.includes("--send");
const DELAY_MS = 1500;

async function main() {
  // Dynamic imports so the env loading above runs before lib/db.ts reads
  // process.env.DATABASE_URL at module load time. Static imports get hoisted
  // above the env-loading loop, which makes the pool default to localhost:5432.
  const { Pool } = await import("pg");
  const { processAutoReply } = await import("../app/api/auto-reply/processor");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

  const r = await pool.query(`
    SELECT id, workspace_slug, lead_email, lead_name, received_at
    FROM replies
    WHERE status = 'new'
      AND received_at > NOW() - INTERVAL '24 hours'
    ORDER BY received_at ASC
  `);

  console.log(`[backfill] ${r.rows.length} stuck replies found in last 24h`);
  if (!SEND) {
    console.log("[backfill] DRY RUN, pass --send to actually process");
    r.rows.slice(0, 30).forEach(row =>
      console.log(`  ${row.received_at.toISOString()}  ${row.workspace_slug.padEnd(20)}  ${row.lead_email}`)
    );
    if (r.rows.length > 30) console.log(`  ... and ${r.rows.length - 30} more`);
    await pool.end();
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const row of r.rows) {
    try {
      await processAutoReply(row.id, row.workspace_slug);
      ok++;
      console.log(`[backfill] ${ok + fail}/${r.rows.length}  OK   ${row.workspace_slug.padEnd(20)} ${row.lead_email}`);
    } catch (err: any) {
      fail++;
      console.error(`[backfill] ${ok + fail}/${r.rows.length}  FAIL ${row.workspace_slug.padEnd(20)} ${row.lead_email}: ${err.message || err}`);
    }
    await new Promise(res => setTimeout(res, DELAY_MS));
  }
  console.log(`[backfill] done, ok=${ok} fail=${fail}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

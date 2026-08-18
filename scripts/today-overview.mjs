import pg from "pg";
import fs from "fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 5 });

async function main() {
  const client = await pool.connect();
  try {
    // Today in US Eastern (per project_daily_update_timezone.md)
    const { rows: todayRow } = await client.query(
      `select (now() at time zone 'America/New_York')::date as today`
    );
    const today = todayRow[0].today;

    console.log("=== TODAY (US Eastern):", today, "===\n");

    // 1. Replies received today, by status
    const { rows: byStatus } = await client.query(
      `select status, count(*) as n
       from replies
       where (received_at at time zone 'America/New_York')::date = $1
       group by status
       order by n desc`,
      [today]
    );
    console.log("-- Replies received today, by status --");
    console.table(byStatus);

    // 2. Replies received today, by workspace
    const { rows: byWs } = await client.query(
      `select workspace_slug, count(*) as n
       from replies
       where (received_at at time zone 'America/New_York')::date = $1
       group by workspace_slug
       order by n desc`,
      [today]
    );
    console.log("-- Replies received today, by workspace --");
    console.table(byWs);

    // 3. Stuck / stale replies (status='new' older than 10 min, should have been swept)
    const { rows: stuck } = await client.query(
      `select id, workspace_slug, lead_email, status, received_at,
              extract(epoch from (now() - received_at))/60 as age_min
       from replies
       where status = 'new'
         and received_at < now() - interval '10 minutes'
       order by received_at asc
       limit 20`
    );
    console.log("-- Stuck in status='new' >10min (sweeper miss candidates) --");
    console.table(stuck);

    // 4. Errored today
    const { rows: errored } = await client.query(
      `select id, workspace_slug, lead_email, received_at
       from replies
       where status = 'errored'
         and (received_at at time zone 'America/New_York')::date = $1
       order by received_at desc`,
      [today]
    );
    console.log("-- Errored today --");
    console.table(errored);

    // 5. Awaiting approval / manual right now (backlog, not just today)
    const { rows: backlog } = await client.query(
      `select workspace_slug, status, count(*) as n,
              min(received_at) as oldest
       from replies
       where status in ('awaiting_approval','awaiting_manual')
       group by workspace_slug, status
       order by n desc`
    );
    console.log("-- Current backlog: awaiting_approval / awaiting_manual (all-time open) --");
    console.table(backlog);

    // 6. Auto-sends today (replied / forwarded) by workspace
    const { rows: sentToday } = await client.query(
      `select workspace_slug, status, count(*) as n
       from replies
       where status in ('replied','forwarded','read')
         and (received_at at time zone 'America/New_York')::date = $1
       group by workspace_slug, status
       order by workspace_slug`,
      [today]
    );
    console.log("-- Closed today (replied/forwarded/read), by workspace --");
    console.table(sentToday);

    // 7. Meetings/calls booked today
    const { rows: calls } = await client.query(
      `select workspace_slug, source, count(*) as n
       from calls
       where (created_at at time zone 'America/New_York')::date = $1
       group by workspace_slug, source
       order by n desc`,
      [today]
    );
    console.log("-- Calls/meetings booked today --");
    console.table(calls);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});

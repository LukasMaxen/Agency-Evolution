import { readFileSync } from "fs";
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

(async () => {
  const r = await pool.query(
    "SELECT id, workspace_slug, campaign, subject, received_at, status, interested FROM replies WHERE lower(lead_email) = $1 OR lower(preferred_recipient_email) = $1 ORDER BY received_at DESC",
    ["lara@kitbrix.com"]
  );
  console.log(JSON.stringify(r.rows, null, 2));
  const calls = await pool.query(
    "SELECT id, workspace_slug, lead_email, scheduled_at, calendly_event_uri FROM calls WHERE lower(lead_email) = $1 ORDER BY scheduled_at DESC",
    ["lara@kitbrix.com"]
  );
  console.log("CALLS:", JSON.stringify(calls.rows, null, 2));
  process.exit(0);
})();

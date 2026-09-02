import fs from "fs";
import path from "path";
import pg from "pg";

const projectRoot = "/Users/kasperaggerholm/Agency-Evolution";
const envPath = path.join(projectRoot, ".env.local");
const envRaw = fs.readFileSync(envPath, "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const TARGET_DATE = "2026-09-01";

const EXCLUDED = new Set([
  "micro-nordic",
  "sro-consulting",
  "zenith-global",
  "venture-exits",
  "zebs-ibs",
  "wrobel-capital",
  "itg-group",
  "911-restoration",
]);

const AIRTABLE = {
  "ah-consulting": { base: "appZhEsVN52VXPZ66", table: "tblTnxArHDVMNOxSI", field: "Meeting booked date" },
  "act-capital": { base: "appECObQrdSRjeXeM", table: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  "acceler8rs": { base: "appp8h0kv9DEHYpXR", table: "tblkoizZek5r5wi45", field: "Meeting booked date", dealSource: "Lukas" },
  "larsen-digital": { base: "appp8h0kv9DEHYpXR", table: "tblkoizZek5r5wi45", field: "Meeting booked date", dealSource: "Nicklas" },
  "gn-motion": { base: "appL5fZEyULdqpyx5", table: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  "hahnbeck": { base: "appUZr45I0MK7uv3w", table: "tbl9KatGYqPFB45Hs", field: "Meeting booked date" },
  "internal-campaigns": { base: "app9rWZ2iE4eWECEN", table: "tblCATnaPTV9fb2Ab", field: "Meeting booked date" },
  "sonaro-ai": { base: "appNMGCTwXVOLLzmA", table: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  "statera-capital": { base: "app0EI3nqT3ScUJOf", table: "tblTnxArHDVMNOxSI", field: "Meeting Booked Date" },
  "with-pebble": { base: "appjEe12UdVsRX10y", table: "tblTnxArHDVMNOxSI", field: "Meeting booked date" },
};

async function main() {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: false });
  const { rows: workspaces } = await pool.query(
    "SELECT slug, name, email_bison_instance_url, email_bison_api_key FROM workspaces ORDER BY slug"
  );
  await pool.end();

  const results = [];

  for (const ws of workspaces) {
    if (EXCLUDED.has(ws.slug)) continue;
    if (!ws.email_bison_api_key || !ws.email_bison_instance_url) continue;

    let stats = { emails_sent: 0, unique_replies_per_contact: 0, interested: 0 };
    try {
      const url = new URL("/api/workspaces/v1.1/stats", ws.email_bison_instance_url);
      url.searchParams.set("start_date", TARGET_DATE);
      url.searchParams.set("end_date", TARGET_DATE);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${ws.email_bison_api_key}` },
      });
      const json = await res.json();
      if (json?.data) {
        stats = {
          emails_sent: json.data.emails_sent ?? 0,
          unique_replies_per_contact: json.data.unique_replies_per_contact ?? 0,
          interested: json.data.interested ?? 0,
        };
      } else {
        stats.error = `no data field: ${JSON.stringify(json).slice(0, 200)}`;
      }
    } catch (e) {
      stats.error = String(e.message || e);
    }

    let meetings = 0;
    let meetingsNote = "";
    const atCfg = AIRTABLE[ws.slug];
    if (atCfg) {
      try {
        let formula = `IS_SAME({${atCfg.field}}, '${TARGET_DATE}', 'day')`;
        if (atCfg.dealSource) {
          formula = `AND(${formula}, {Deal Source} = '${atCfg.dealSource}')`;
        }
        const atUrl = new URL(`https://api.airtable.com/v0/${atCfg.base}/${atCfg.table}`);
        atUrl.searchParams.set("filterByFormula", formula);
        atUrl.searchParams.append("fields[]", atCfg.field);
        const res = await fetch(atUrl, {
          headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
        });
        const json = await res.json();
        if (json?.records) {
          meetings = json.records.length;
        } else {
          meetingsNote = `airtable error: ${JSON.stringify(json).slice(0, 200)}`;
        }
      } catch (e) {
        meetingsNote = String(e.message || e);
      }
    } else if (ws.slug !== "internal-campaigns") {
      meetingsNote = "no airtable config mapped";
    }

    results.push({
      slug: ws.slug,
      name: ws.name,
      ...stats,
      meetings,
      meetingsNote,
    });
  }

  console.log(JSON.stringify({ date: TARGET_DATE, results }, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});

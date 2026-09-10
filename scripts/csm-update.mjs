#!/usr/bin/env node
// CSM update — single-shot, parallel fetch of EmailBison stats + Airtable meetings for
// every configured client, for one date window. Replaces the old manual
// SQL-then-curl-per-workspace-then-curl-per-Airtable-base recipe (slow, and fragile: a
// workspace's EmailBison API key can contain a literal "|" character, which silently
// breaks any pipe-delimited text parsing of DB output).
//
// Config lives in scripts/csm-update.config.json (excluded clients, report line labels,
// which workspace slugs roll into each line, Airtable meetings base/table/field/deal-source
// per line). Edit that file when a client is added, removed, or re-mapped — never hardcode
// client lists in this script.
//
// Usage:
//   node scripts/csm-update.mjs                        yesterday (US Eastern), default
//   node scripts/csm-update.mjs --date 2026-09-10       one specific day
//   node scripts/csm-update.mjs --window last7          rolling 7 days ending yesterday
//   node scripts/csm-update.mjs --window last30         rolling 30 days ending yesterday
//   node scripts/csm-update.mjs --window monday-week    last Mon-Fri (the Monday report)
//   node scripts/csm-update.mjs --start 2026-09-01 --end 2026-09-07
//
// Any workspace found in the DB that is neither in excludedSlugs nor mapped into a report
// line is NEVER silently included or dropped — it is printed as a NEW WORKSPACE warning at
// the top of the output so Kasper can be asked before it's added to the config.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ---- env (manual .env.local parse so this runs the same with plain `node`, no flags) ----
function loadEnvLocal() {
  let content;
  try {
    content = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

const CONFIG = JSON.parse(readFileSync(path.join(__dirname, "csm-update.config.json"), "utf8"));

// ---- date window resolution (US Eastern, matches EmailBison's server timezone) ----
function easternDateString(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function todayEastern() {
  return easternDateString(new Date());
}
function resolveWindow(argv) {
  const get = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const explicitDate = get("date");
  const start = get("start");
  const end = get("end");
  const window = get("window");

  const yesterday = addDaysToDateString(todayEastern(), -1);

  if (explicitDate) return { start: explicitDate, end: explicitDate, label: explicitDate };
  if (start && end) return { start, end, label: `${start} to ${end}` };
  if (window === "last7") return { start: addDaysToDateString(yesterday, -6), end: yesterday, label: "last 7 days" };
  if (window === "last30") return { start: addDaysToDateString(yesterday, -29), end: yesterday, label: "last 30 days" };
  if (window === "monday-week") {
    // yesterday's weekday in ET: 0=Sun..6=Sat. Walk back to the most recent Monday, then Fri = Mon+4.
    const [y, m, d] = yesterday.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const daysSinceMonday = (dow + 6) % 7;
    const monday = addDaysToDateString(yesterday, -daysSinceMonday);
    const friday = addDaysToDateString(monday, 4);
    return { start: monday, end: friday, label: "last Mon-Fri" };
  }
  return { start: yesterday, end: yesterday, label: "yesterday" };
}

// ---- EmailBison ----
async function fetchEBStats(slug, instanceUrl, apiKey, start, end) {
  const params = new URLSearchParams({ start_date: start, end_date: end });
  try {
    const res = await fetch(`${instanceUrl.replace(/\/$/, "")}/api/workspaces/v1.1/stats?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { slug, ok: false, error: `HTTP ${res.status} ${text.slice(0, 150)}` };
    }
    const j = await res.json();
    const d = j?.data ?? {};
    return {
      slug,
      ok: true,
      emails_sent: Number(d.emails_sent ?? 0) || 0,
      replies: Number(d.unique_replies_per_contact ?? 0) || 0,
      interested: Number(d.interested ?? 0) || 0,
    };
  } catch (err) {
    return { slug, ok: false, error: err?.message ?? String(err) };
  }
}

// ---- Airtable ----
async function fetchAirtableMeetingCount(meetingsCfg, start, end) {
  const { baseId, tableId, bookedDateField, dealSourceField, dealSourceValue } = meetingsCfg;
  const dateClause =
    start === end
      ? `IS_SAME({${bookedDateField}}, '${start}', 'day')`
      : `AND(IS_ON_OR_AFTER({${bookedDateField}}, '${start}'), IS_ON_OR_BEFORE({${bookedDateField}}, '${end}'))`;
  const formula = dealSourceField
    ? `AND(${dateClause}, {${dealSourceField}} = '${dealSourceValue}')`
    : dateClause;

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
  url.searchParams.set("filterByFormula", formula);
  url.searchParams.append("fields[]", bookedDateField);
  url.searchParams.set("pageSize", "100");

  let count = 0;
  let offset;
  try {
    do {
      if (offset) url.searchParams.set("offset", offset);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 150)}` };
      }
      const j = await res.json();
      count += (j.records ?? []).length;
      offset = j.offset;
    } while (offset);
    return { ok: true, count };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// ---- formatting ----
function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}
function fmtPct(n) {
  return n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}
function pct(numerator, denominator, zeroDenomLabel = "TBD%") {
  if (!denominator) return zeroDenomLabel;
  return fmtPct((numerator / denominator) * 100);
}

async function main() {
  const { start, end, label } = resolveWindow(process.argv.slice(2));

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  const { rows: workspaces } = await pool.query(
    "SELECT slug, name, email_bison_instance_url, email_bison_api_key FROM workspaces ORDER BY slug"
  );
  await pool.end();

  const wsBySlug = Object.fromEntries(workspaces.map((w) => [w.slug, w]));
  const mappedSlugs = new Set(CONFIG.reportLines.flatMap((l) => l.workspaceSlugs));
  const excludedSlugs = new Set(CONFIG.excludedSlugs);

  const unmapped = workspaces.filter((w) => !mappedSlugs.has(w.slug) && !excludedSlugs.has(w.slug));

  // Fetch EB stats for every slug any report line needs, in one parallel batch.
  const neededSlugs = [...mappedSlugs].filter((s) => wsBySlug[s]);
  const missingCreds = [...mappedSlugs].filter((s) => !wsBySlug[s]);

  const ebResults = await Promise.all(
    neededSlugs.map((slug) => {
      const w = wsBySlug[slug];
      return fetchEBStats(slug, w.email_bison_instance_url, w.email_bison_api_key, start, end);
    })
  );
  const ebBySlug = Object.fromEntries(ebResults.map((r) => [r.slug, r]));

  // Fetch Airtable meetings for every report line in one parallel batch.
  const meetingResults = await Promise.all(
    CONFIG.reportLines.map((line) => fetchAirtableMeetingCount(line.meetings, start, end))
  );

  const warnings = [];
  if (unmapped.length) {
    warnings.push(
      "NEW / UNMAPPED WORKSPACE(S) FOUND — not included below, ask Kasper before adding:\n" +
        unmapped.map((w) => `  - ${w.slug} ("${w.name}", ${w.email_bison_instance_url})`).join("\n")
    );
  }
  if (missingCreds.length) {
    warnings.push(`Missing DB credentials for mapped slug(s): ${missingCreds.join(", ")} — check csm-update.config.json vs workspaces table.`);
  }
  for (const r of ebResults) {
    if (!r.ok) warnings.push(`EmailBison fetch FAILED for "${r.slug}": ${r.error} — numbers below exclude this workspace, do not treat totals as complete.`);
  }
  meetingResults.forEach((r, i) => {
    if (!r.ok) warnings.push(`Airtable meetings fetch FAILED for "${CONFIG.reportLines[i].label}": ${r.error} — meetings for this client are missing below.`);
  });

  const lines = [];
  let totalSent = 0, totalReplies = 0, totalInterested = 0, totalMeetings = 0;

  for (let i = 0; i < CONFIG.reportLines.length; i++) {
    const cfg = CONFIG.reportLines[i];
    let sent = 0, replies = 0, interested = 0;
    for (const slug of cfg.workspaceSlugs) {
      const r = ebBySlug[slug];
      if (r?.ok) { sent += r.emails_sent; replies += r.replies; interested += r.interested; }
    }
    const meetingsRes = meetingResults[i];
    const meetings = meetingsRes.ok ? meetingsRes.count : 0;

    totalSent += sent; totalReplies += replies; totalInterested += interested; totalMeetings += meetings;

    const replyRate = pct(replies, sent);
    const interestedPct = pct(interested, replies);
    const meetingsPct = interested === 0 ? "TBD%" : pct(meetings, interested, "0,00%");

    lines.push(
      `${cfg.label}:\n` +
      `Emails Sent: ${fmtInt(sent)}\n` +
      `Total Replies: ${fmtInt(replies)}\n` +
      `Reply Rate: ${replyRate}\n` +
      `Interested Replies: ${fmtInt(interested)} - ${interestedPct}\n` +
      `Meetings Booked: ${fmtInt(meetings)} - ${meetingsPct}\n` +
      `Note:\n` +
      `________________________________________`
    );
  }

  const totalReplyRate = pct(totalReplies, totalSent);
  const totalPositiveRate = pct(totalInterested, totalReplies);
  const totalMeetingConv = totalInterested === 0 ? "TBD%" : pct(totalMeetings, totalInterested, "0,00%");
  const emailsPerLead = totalInterested === 0 ? "N/A" : fmtInt(totalSent / totalInterested);
  const emailsPerMeeting = totalMeetings === 0 ? "N/A" : fmtInt(totalSent / totalMeetings);

  const out = [];
  out.push(`CSM Update — ${label} (${start}${end !== start ? " to " + end : ""})`);
  out.push("");
  if (warnings.length) {
    out.push("=== WARNINGS (resolve/ask before trusting totals) ===");
    out.push(...warnings);
    out.push("");
  }
  out.push(...lines);
  out.push("");
  out.push(`Total Numbers ${label === "yesterday" ? "Yesterday" : `(${label})`}:`);
  out.push("");
  out.push(`Emails Sent: ${fmtInt(totalSent)}`);
  out.push(`Total Replies: ${fmtInt(totalReplies)}`);
  out.push(`Reply Rate %: ${totalReplyRate}`);
  out.push(`Positive Replies: ${fmtInt(totalInterested)}`);
  out.push(`Positive Reply Rate %: ${totalPositiveRate}`);
  out.push(`Meetings: ${fmtInt(totalMeetings)}`);
  out.push(`Meeting Conversion %: ${totalMeetingConv}`);
  out.push("");
  out.push("Efficiency");
  out.push(`Emails to get a Lead: ${emailsPerLead}`);
  out.push(`Emails to get a Meeting: ${emailsPerMeeting}`);

  console.log(out.join("\n"));
}

main().catch((err) => {
  console.error("CSM update script failed:", err);
  process.exit(1);
});

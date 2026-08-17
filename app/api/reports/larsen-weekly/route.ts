// Manual trigger for the Larsen weekly outreach tracker (see lib/reports/larsen-weekly.ts).
// Runs automatically every Monday via instrumentation.ts, this route exists for testing
// and backfilling a specific week.
//
//   POST /api/reports/larsen-weekly              -> writes last week's block
//   POST /api/reports/larsen-weekly?week=2026-08-03  -> writes the block for that week
//   (week must be a Monday already present in the sheet)
//   GET  /api/reports/larsen-weekly?debug=1       -> diagnostics only, no write. Checks
//   whether CALENDLY_TOKEN_LARSEN_DIGITAL is deployed correctly and can actually reach
//   Calendly, without exposing the token itself. Added 2026-08-17 after a fix that was
//   supposed to resolve Nicklas Pathfinder meetings showing 0 turned out not to, so we
//   needed a way to see what's wrong in production without server log access.

import { NextRequest, NextResponse } from "next/server";
import { runLarsenWeeklyReport } from "@/lib/reports/larsen-weekly";

export async function POST(req: NextRequest) {
  try {
    const weekParam = req.nextUrl.searchParams.get("week");
    const weekStart = weekParam ? new Date(`${weekParam}T00:00:00Z`) : undefined;
    await runLarsenWeeklyReport(weekStart);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[api/reports/larsen-weekly] error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("debug") !== "1") {
    return NextResponse.json({ error: "add ?debug=1" }, { status: 400 });
  }

  const raw = process.env.CALENDLY_TOKEN_LARSEN_DIGITAL ?? "";
  const tokenInfo = {
    set: raw.length > 0,
    length: raw.length,
    startsWithQuote: raw.startsWith('"') || raw.startsWith("'"),
    endsWithQuote: raw.endsWith('"') || raw.endsWith("'"),
    hasLeadingOrTrailingWhitespace: raw !== raw.trim(),
    prefix: raw.slice(0, 6),
  };

  // A known-real scheduled event from the 2026-08-10 week, used purely to test whether
  // the deployed token can authenticate against Calendly right now.
  const testEventUri = "https://api.calendly.com/scheduled_events/7f49d8a7-1af1-4377-8e02-76fafd1ab842";
  let calendlyTest: { status: number; ok: boolean; body: string };
  try {
    const res = await fetch(testEventUri, { headers: { Authorization: `Bearer ${raw.trim().replace(/^["']|["']$/g, "")}` } });
    const text = await res.text();
    calendlyTest = { status: res.status, ok: res.ok, body: text.slice(0, 200) };
  } catch (e: any) {
    calendlyTest = { status: 0, ok: false, body: e?.message ?? String(e) };
  }

  return NextResponse.json({ tokenInfo, calendlyTest });
}

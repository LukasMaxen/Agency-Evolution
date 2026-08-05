// Manual trigger for the Larsen weekly outreach tracker (see lib/reports/larsen-weekly.ts).
// Runs automatically every Monday via instrumentation.ts — this route exists for testing
// and backfilling a specific week.
//
//   POST /api/reports/larsen-weekly              -> writes last week's block
//   POST /api/reports/larsen-weekly?week=2026-08-03  -> writes the block for that week
//   (week must be a Monday already present in the sheet)

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

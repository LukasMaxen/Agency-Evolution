import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { processAutoReply } from "@/app/api/auto-reply/processor";

// Coolify proxy timeout is the binding constraint, not Next. The 2-min hold
// + ~30s processor work fits well under 5 min.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const HOLD_MS = 2 * 60 * 1000;

// POST /api/auto-reply/run?id=<reply_uuid>&workspace=<slug>
//
// Self-fetched by the LEAD_REPLIED webhook so processAutoReply runs as its
// own real HTTP request. The webhook handler used to schedule processAutoReply
// via Next 16 `after()`, but the Coolify runtime started dropping those
// callbacks silently (replies stalled at status='new' with no #reply-approval
// card). A real HTTP request has a guaranteed request lifetime up to
// maxDuration, so the processor reliably runs end to end.
//
// Auth via AUTO_REPLY_RUN_TOKEN (same value in webhook + this route).
export async function POST(req: NextRequest) {
  const expected = process.env.AUTO_REPLY_RUN_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "AUTO_REPLY_RUN_TOKEN not configured" }, { status: 500 });
  }
  const token = req.headers.get("x-internal-token");
  if (token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  const workspace = req.nextUrl.searchParams.get("workspace");
  if (!id || !workspace) {
    return NextResponse.json({ error: "missing id or workspace" }, { status: 400 });
  }

  // Wait until the reply is past the dedup hold. processAutoReply has its own
  // hold check as a backstop; this sleep just avoids the wasted claim/reset cycle.
  const row = await pool.query(`SELECT received_at FROM replies WHERE id = $1`, [id]);
  if (row.rows.length > 0) {
    const age = Date.now() - new Date(row.rows[0].received_at).getTime();
    const remaining = HOLD_MS - age;
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
  }

  try {
    await processAutoReply(id, workspace);
    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    console.error(`[run] processAutoReply failed for ${id} (${workspace}):`, err);
    return NextResponse.json({ error: err.message ?? "processor error" }, { status: 500 });
  }
}

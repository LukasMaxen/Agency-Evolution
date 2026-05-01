import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { processAutoReply } from "@/lib/auto-reply";

// POST /api/auto-reply — manually trigger auto-reply for a reply ID
export async function POST(req: NextRequest) {
  try {
    const { replyId } = await req.json();

    if (!replyId) {
      return NextResponse.json({ error: "replyId is required" }, { status: 400 });
    }

    const result = await pool.query(
      "SELECT workspace_slug FROM replies WHERE id = $1",
      [replyId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    }

    const { workspace_slug } = result.rows[0];

    await processAutoReply(replyId, workspace_slug);

    return NextResponse.json({ ok: true, replyId });
  } catch (err: any) {
    console.error("[auto-reply route] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/variant-refresh/reject
// Marks a pending refresh as rejected so the variant row resets to allow regeneration.
// Body: { refresh_id: string }
export async function POST(req: NextRequest) {
  try {
    const { refresh_id } = await req.json();

    if (!refresh_id) {
      return NextResponse.json({ error: "refresh_id is required" }, { status: 400 });
    }

    const result = await pool.query(
      "UPDATE variant_refresh_log SET status = 'rejected', reviewed_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id",
      [refresh_id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Refresh not found or not in pending state" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[variant-refresh/reject] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

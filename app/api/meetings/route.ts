import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workspace = searchParams.get("workspace") ?? "all";

    let query = `
      SELECT * FROM meetings
      WHERE status = 'scheduled'
    `;
    const values: any[] = [];

    if (workspace !== "all") {
      query += ` AND workspace_slug = $1`;
      values.push(workspace);
    }

    query += ` ORDER BY meeting_date ASC`;

    const result = await pool.query(query, values);

    return NextResponse.json({ meetings: result.rows });
  } catch (err: any) {
    console.error("[meetings] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
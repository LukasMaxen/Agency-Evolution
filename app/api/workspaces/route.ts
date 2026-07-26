import { NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/workspaces
// Returns all workspaces from the DB so the UI stays in sync automatically.
// Any workspace added to the DB (e.g. internal-campaigns) appears in tabs
// without touching mock-data.ts.
export async function GET() {
  try {
    const result = await pool.query(
      `SELECT
         id::text                  AS id,
         slug,
         name,
         email_bison_instance_url  AS "instanceUrl"
       FROM workspaces
       ORDER BY name ASC`
    );

    // Build a colour + initials from the slug so the UI has something to
    // render even for workspaces that were never in mock-data.ts.
    const COLORS = [
      "#185FA5", "#0F6E56", "#7C3AED", "#B45309", "#DC2626",
      "#533AB7", "#0369A1", "#9D174D", "#065F46", "#1E3A5F",
      "#6D28D9", "#92400E", "#0F766E", "#374151", "#7C2D12",
    ];

    const workspaces = result.rows.map((row, i) => {
      const words = row.name.split(/[\s-]+/).filter(Boolean);
      const initials = words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : row.name.slice(0, 2).toUpperCase();
      return {
        id:          row.id,
        slug:        row.slug,
        name:        row.name,
        instanceUrl: row.instanceUrl ?? "",
        color:       COLORS[i % COLORS.length],
        initials,
      };
    });

    return NextResponse.json({ workspaces });
  } catch (err: any) {
    console.error("[api/workspaces] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// GET /api/emailbison/campaigns?workspace=slug&search=optional
// Lists all campaigns for a workspace. Used to find campaign IDs before reading/updating sequences.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workspace = searchParams.get("workspace");
    const search = searchParams.get("search");

    if (!workspace) {
      return NextResponse.json({ error: "workspace query param required" }, { status: 400 });
    }

    const wsResult = await pool.query(
      "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
      [workspace]
    );

    if (wsResult.rows.length === 0) {
      return NextResponse.json({ error: `Workspace '${workspace}' not found` }, { status: 404 });
    }

    const { email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = wsResult.rows[0];

    if (!apiKey || !instanceUrl) {
      return NextResponse.json({ error: "Workspace missing EmailBison credentials" }, { status: 400 });
    }

    const ebResponse = await fetch(`${instanceUrl}/api/campaigns`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: search ? JSON.stringify({ search }) : undefined,
    });

    if (!ebResponse.ok) {
      const errText = await ebResponse.text();
      return NextResponse.json(
        { error: `EmailBison error ${ebResponse.status}: ${errText}` },
        { status: ebResponse.status }
      );
    }

    const data = await ebResponse.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("[emailbison/campaigns] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

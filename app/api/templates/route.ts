import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceSlug = searchParams.get("workspace");

    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspace param required" }, { status: 400 });
    }

    // Get workspace API key
    const wsResult = await pool.query(
      "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
      [workspaceSlug]
    );

    if (wsResult.rows.length === 0) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const { email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = wsResult.rows[0];

    if (!apiKey) {
      return NextResponse.json({ error: "Workspace API key not configured" }, { status: 400 });
    }

    // Fetch templates from EmailBison
    const res = await fetch(`${instanceUrl}/api/reply-templates`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[templates] EmailBison error:", err);
      return NextResponse.json(
        { error: `EmailBison API error: ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();

    // EmailBison returns { data: [...] } or just an array
    const templates = data.data ?? data ?? [];

    return NextResponse.json({ templates });

  } catch (err: any) {
    console.error("[templates] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
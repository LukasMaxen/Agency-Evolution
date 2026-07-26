import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

type Ctx = { params: Promise<{ campaign_id: string }> };

async function getWorkspaceCreds(workspace: string) {
  const result = await pool.query(
    "SELECT email_bison_api_key, email_bison_instance_url FROM workspaces WHERE slug = $1",
    [workspace]
  );
  if (result.rows.length === 0) return null;
  const { email_bison_api_key: apiKey, email_bison_instance_url: instanceUrl } = result.rows[0];
  if (!apiKey || !instanceUrl) return null;
  return { apiKey, instanceUrl };
}

// GET /api/emailbison/campaigns/[campaign_id]/sequence-steps?workspace=slug
// Returns the current sequence steps for a campaign.
// Uses the v1.1 endpoint first (returns step IDs needed for updates), falls back to deprecated.
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { campaign_id } = await ctx.params;
    const workspace = new URL(req.url).searchParams.get("workspace");

    if (!workspace) {
      return NextResponse.json({ error: "workspace query param required" }, { status: 400 });
    }

    const creds = await getWorkspaceCreds(workspace);
    if (!creds) {
      return NextResponse.json({ error: `Workspace '${workspace}' not found or missing credentials` }, { status: 404 });
    }

    const { apiKey, instanceUrl } = creds;

    // Try v1.1 first — returns step IDs required for PUT updates
    let ebResponse = await fetch(
      `${instanceUrl}/api/campaigns/v1.1/${campaign_id}/sequence-steps`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      }
    );

    // Fall back to deprecated endpoint if v1.1 not available
    if (!ebResponse.ok && ebResponse.status === 404) {
      ebResponse = await fetch(
        `${instanceUrl}/api/campaigns/${campaign_id}/sequence-steps`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
        }
      );
    }

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
    console.error("[emailbison/sequence-steps] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/emailbison/campaigns/[campaign_id]/sequence-steps?workspace=slug
// Pushes updated sequence steps to EmailBison after review approval.
// Body: { sequence_id: number, title: string, sequence_steps: SequenceStep[] }
// If no sequence_id is provided, creates the sequence from scratch (replaces existing).
//
// SequenceStep shape:
//   { id?: number, email_subject: string, email_body: string, order: number,
//     wait_in_days: number, variant: boolean, thread_reply: boolean,
//     variant_from_step?: number | null }
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { campaign_id } = await ctx.params;
    const workspace = new URL(req.url).searchParams.get("workspace");

    if (!workspace) {
      return NextResponse.json({ error: "workspace query param required" }, { status: 400 });
    }

    const creds = await getWorkspaceCreds(workspace);
    if (!creds) {
      return NextResponse.json({ error: `Workspace '${workspace}' not found or missing credentials` }, { status: 404 });
    }

    const { apiKey, instanceUrl } = creds;
    const body = await req.json();
    const { sequence_id, title, sequence_steps } = body;

    if (!sequence_steps || !Array.isArray(sequence_steps) || sequence_steps.length === 0) {
      return NextResponse.json({ error: "sequence_steps array is required" }, { status: 400 });
    }

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    let ebResponse: Response;

    if (sequence_id) {
      // Update existing sequence via v1.1 endpoint
      ebResponse = await fetch(
        `${instanceUrl}/api/campaigns/v1.1/sequence-steps/${sequence_id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ title, sequence_steps }),
        }
      );
    } else {
      // No sequence_id — create sequence from scratch via v1.1 (replaces existing steps)
      ebResponse = await fetch(
        `${instanceUrl}/api/campaigns/v1.1/${campaign_id}/sequence-steps`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ title, sequence_steps }),
        }
      );
    }

    if (!ebResponse.ok) {
      const errText = await ebResponse.text();
      console.error("[emailbison/sequence-steps] PUT/POST to EB failed:", errText);
      return NextResponse.json(
        { error: `EmailBison error ${ebResponse.status}: ${errText}` },
        { status: ebResponse.status }
      );
    }

    const data = await ebResponse.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("[emailbison/sequence-steps] PUT error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

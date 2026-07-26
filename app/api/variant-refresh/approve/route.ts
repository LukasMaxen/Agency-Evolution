import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// POST /api/variant-refresh/approve
// Fetches current sequence from EmailBison, replaces the matching step body, pushes back, marks log as pushed.
// Body: { refresh_id: string, workspace: string }
export async function POST(req: NextRequest) {
  try {
    const { refresh_id, workspace } = await req.json();

    if (!refresh_id || !workspace) {
      return NextResponse.json({ error: "refresh_id and workspace are required" }, { status: 400 });
    }

    // Fetch the pending refresh log entry
    const logResult = await pool.query(
      "SELECT * FROM variant_refresh_log WHERE id = $1 AND status = 'pending'",
      [refresh_id]
    );
    if (logResult.rows.length === 0) {
      return NextResponse.json({ error: "Refresh not found or already processed" }, { status: 404 });
    }

    const log = logResult.rows[0];
    const { campaign_id, original_body, refreshed_body } = log;

    const base = new URL(req.url).origin;

    // Fetch current sequence steps from EmailBison via our proxy
    const stepsRes = await fetch(
      `${base}/api/emailbison/campaigns/${campaign_id}/sequence-steps?workspace=${workspace}`
    );
    if (!stepsRes.ok) {
      const err = await stepsRes.text();
      return NextResponse.json({ error: `Failed to fetch sequence steps: ${err}` }, { status: 502 });
    }

    const stepsData = await stepsRes.json();

    // EmailBison returns { data: { sequence: { id, title, sequence_steps: [...] } } } or similar
    // Extract the sequence array — handle both response shapes
    let sequenceId: number | undefined;
    let sequenceTitle: string = "";
    let steps: any[] = [];

    if (stepsData?.data?.sequence) {
      sequenceId = stepsData.data.sequence.id;
      sequenceTitle = stepsData.data.sequence.title ?? "";
      steps = stepsData.data.sequence.sequence_steps ?? [];
    } else if (stepsData?.sequence) {
      sequenceId = stepsData.sequence.id;
      sequenceTitle = stepsData.sequence.title ?? "";
      steps = stepsData.sequence.sequence_steps ?? [];
    } else if (Array.isArray(stepsData)) {
      steps = stepsData;
    } else if (Array.isArray(stepsData?.data)) {
      steps = stepsData.data;
    }

    if (steps.length === 0) {
      return NextResponse.json({ error: "No sequence steps returned from EmailBison" }, { status: 422 });
    }

    // Find step matching the original body (exact match after trim)
    const originalTrimmed = original_body.trim();
    let matchIndex = steps.findIndex(
      (s: any) => (s.email_body ?? "").trim() === originalTrimmed
    );

    if (matchIndex === -1) {
      return NextResponse.json(
        { error: "No sequence step found matching this variant body. The campaign may have changed since this refresh was generated." },
        { status: 422 }
      );
    }

    // Replace body on the matched step
    const updatedSteps = steps.map((s: any, i: number) =>
      i === matchIndex ? { ...s, email_body: refreshed_body } : s
    );

    // Push updated steps back to EmailBison
    const pushRes = await fetch(
      `${base}/api/emailbison/campaigns/${campaign_id}/sequence-steps?workspace=${workspace}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sequence_id: sequenceId,
          title: sequenceTitle,
          sequence_steps: updatedSteps,
        }),
      }
    );

    if (!pushRes.ok) {
      const err = await pushRes.text();
      return NextResponse.json({ error: `Failed to push to EmailBison: ${err}` }, { status: 502 });
    }

    // Mark log entry as pushed
    await pool.query(
      "UPDATE variant_refresh_log SET status = 'pushed', pushed_at = NOW(), reviewed_at = NOW() WHERE id = $1",
      [refresh_id]
    );

    return NextResponse.json({ ok: true, matched_step_order: steps[matchIndex]?.order });
  } catch (err: any) {
    console.error("[variant-refresh/approve] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// app/api/webhook/tally/route.ts
//
// Tally webhook receiver for the client "Onboarding" form (workspace n94E1V, form VL6Oj6).
// Registered via POST https://api.tally.so/webhooks (webhook id "31rzWW", 2026-09-03),
// eventTypes: ["FORM_RESPONSE"], no signing secret issued by Tally so there's nothing to
// verify — same trust model as the Calendly/Fillout webhooks in this codebase.
//
// On every submission: upserts a row into the "Clients" table in the Onboarding Library
// Airtable base (see lib/airtable-onboarding.ts). Email notification to Lukas + Kasper is
// handled natively by Tally's own self-email-notification setting, not by this route.
import { NextRequest, NextResponse } from "next/server";
import { upsertClientFromSubmission, TallySubmission } from "@/lib/airtable-onboarding";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = body?.data ?? body;

    const submission: TallySubmission = {
      responseId: data?.responseId,
      submissionId: data?.submissionId,
      formId: data?.formId,
      formName: data?.formName,
      createdAt: data?.createdAt,
      fields: Array.isArray(data?.fields) ? data.fields : [],
    };

    console.log(`[tally webhook] submission ${submission.submissionId ?? "?"} for form ${submission.formId ?? "?"}, ${submission.fields.length} fields`);

    if (submission.fields.length === 0) {
      console.error("[tally webhook] no fields in payload — skipping", JSON.stringify(body).slice(0, 300));
      return NextResponse.json({ ok: true, note: "no_fields" });
    }

    const result = await upsertClientFromSubmission(submission);
    console.log(`[tally webhook] ${result.created ? "created" : "updated"} Airtable record ${result.recordId}`);

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    // Always return 200 — a non-2xx risks Tally disabling the webhook after repeated failures.
    console.error("[tally webhook] error (returning 200 to avoid disable):", err?.message ?? err);
    return NextResponse.json({ ok: false, error: err?.message ?? "handled" });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "AI Reply Desk — Tally onboarding webhook" });
}

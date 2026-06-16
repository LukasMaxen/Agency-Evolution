import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const SYSTEM_PROMPT = `You are a cold email copywriter for B2B and DTC outreach. You rewrite a single email variant following strict rules.

FORMATTING RULES — never violate any of these:
- No em dashes (—) of any kind, anywhere
- No en dashes or hyphens used as punctuation
- No bullet points or numbered lists
- No colons anywhere in the email body
- Use specific numbers (e.g. £25,000 not £25k, $6,342 not $6k)
- No rounded numbers
- No "genuinely," "honestly," "straightforward"
- No "I'd love to" or any hedging language in CTAs
- No "last note from me," "final follow-up," "once more," "just circling back"
- No "I think" or "I believe"
- Short over long. Err toward fewer words. If in doubt, cut.
- Direct, professional, no fluff. Conversational but not casual.
- Never apologetic or defensive in framing.
- No P.S. lines unless they were in the original.

LIGHT REFRESH rules:
Change ONLY: the opening line (different angle, same information), one sentence reworded or moved, CTA phrasing changed slightly.
The email must be recognizably similar to the original. Same structure, same core message, same paragraph count.

MODERATE REFRESH rules:
Change: the opener type (e.g. question to statement or vice versa), the case study or result leading the email, the paragraph structure.
The email must be meaningfully different from the original. At least 65–70% different in wording and visual structure.
Keep the same core offer and CTA type.

EMERGENCY REFRESH rules:
Rewrite the entire email from scratch keeping only the core offer. New opener, new structure, new angle. Maximum difference while preserving the offer.

Return ONLY the rewritten email body. No subject line. No greeting or sign-off. No explanation. No markdown. Plain text only.`;

function refreshType(sendCount: number): "light" | "moderate" {
  return sendCount >= 2000 ? "moderate" : "light";
}

// POST /api/variant-refresh/generate
// Generates a refreshed variant body via Claude and stores in variant_refresh_log (status=pending).
// Body: { workspace_slug, campaign_name, campaign_id, step_order, original_body, send_count, refresh_type? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspace_slug, campaign_name, campaign_id, step_order, original_body, send_count } = body;

    if (!workspace_slug || !campaign_name || !original_body) {
      return NextResponse.json({ error: "workspace_slug, campaign_name, and original_body are required" }, { status: 400 });
    }

    const type: "light" | "moderate" | "emergency" = body.refresh_type ?? refreshType(send_count ?? 0);

    const userMessage = `Refresh type: ${type}
Send count: ${send_count ?? "unknown"} sends on this variant body

Original email body:
${original_body}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: `Anthropic error: ${errText}` }, { status: 502 });
    }

    const data = await response.json();
    const refreshedBody: string = data.content?.[0]?.text?.trim() ?? "";

    if (!refreshedBody) {
      return NextResponse.json({ error: "Empty response from Claude" }, { status: 502 });
    }

    const refreshId = `refresh-${workspace_slug}-${Date.now()}`;

    await pool.query(
      `INSERT INTO variant_refresh_log
        (id, workspace_slug, campaign_name, campaign_id, step_order, original_body, refreshed_body, refresh_type, send_count, status, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())`,
      [
        refreshId,
        workspace_slug,
        campaign_name,
        campaign_id ?? 0,
        step_order ?? 0,
        original_body,
        refreshedBody,
        type,
        send_count ?? 0,
      ]
    );

    return NextResponse.json({ refresh_id: refreshId, refreshed_body: refreshedBody, refresh_type: type });
  } catch (err: any) {
    console.error("[variant-refresh/generate] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

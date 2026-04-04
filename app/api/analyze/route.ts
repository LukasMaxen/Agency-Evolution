import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

const SYSTEM_PROMPT = `You are an AI assistant for a B2B cold email agency managing outreach for private equity and investment banking firms.

Your job is to analyze a lead's reply to a cold email and return a JSON object with:
- intent: one of "interested_urgent" | "interested" | "needs_info" | "neutral" | "not_interested" | "unsubscribe"
- urgency: one of "high" | "medium" | "low"
- summary: a single short sentence (max 12 words) describing what the lead said
- suggestedTemplateId: the best matching template ID from the list, or null
- suggestedReply: a personalized, ready-to-send reply (2-4 short paragraphs, plain text, no placeholders)

Intent definitions:
- interested_urgent: lead confirmed a meeting, gave a specific time/date, or is clearly ready to move immediately
- interested: lead expressed clear interest but no concrete next step yet
- needs_info: lead asked a specific question about the deal, valuation, structure, or documents
- neutral: reply is ambiguous, polite but non-committal
- not_interested: soft no, passing, wrong timing
- unsubscribe: asks to be removed, hard no

Urgency:
- high: action required immediately (time/date given, hot lead, explicit request)
- medium: interested but no deadline
- low: info request, neutral, or declining

Templates available:
t1 = Schedule a call
t2 = Send deck / materials
t3 = Request more info (when they asked a question)
t4 = Not a fit — polite decline
t5 = Follow up — no response
t6 = Confirm meeting (when they confirmed a specific time)

For suggestedReply: write a real, warm, professional reply. Use the lead's first name. Reference what they said specifically. Keep it short (3-6 sentences). Do NOT include subject line. Do NOT use placeholders like [NAME] or [LINK].

Respond ONLY with a valid JSON object. No markdown, no explanation, no code fences.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set in .env.local" },
      { status: 500 }
    );
  }

  const { replyId, leadName, leadEmail, campaign, message } = await req.json();

  if (!leadName || !message) {
    return NextResponse.json(
      { error: "leadName and message are required" },
      { status: 400 }
    );
  }

  // ── Cache check: if replyId provided, return stored result if it exists ──
  if (replyId) {
    try {
      const cached = await pool.query(
        "SELECT ai_analysis FROM replies WHERE id = $1 AND ai_analysis IS NOT NULL",
        [replyId]
      );
      if (cached.rows.length > 0) {
        const analysis = cached.rows[0].ai_analysis;
        return NextResponse.json({ ...analysis, fromCache: true });
      }
    } catch {
      // DB check failed — fall through to AI call
    }
  }

  // ── Call Claude ───────────────────────────────────────────────────────────
  const userMessage = `Lead name: ${leadName}
Lead email: ${leadEmail}
Campaign: ${campaign}
Their reply: "${message}"`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json(
      { error: `Anthropic API error ${response.status}: ${err}` },
      { status: response.status }
    );
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text ?? "";
  const clean = raw.replace(/```json|```/g, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch {
    return NextResponse.json(
      { error: "Failed to parse AI response", raw },
      { status: 500 }
    );
  }

  // ── Persist result to DB so we never re-analyze this reply ───────────────
  if (replyId) {
    try {
      await pool.query(
        "UPDATE replies SET ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2",
        [JSON.stringify(parsed), replyId]
      );
    } catch (err) {
      console.error("[analyze] failed to cache result:", err);
      // Non-fatal — still return the result
    }
  }

  return NextResponse.json(parsed);
}
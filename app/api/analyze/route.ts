import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { backsyncInterestedToEmailBison } from "@/lib/emailbison-backsync";

// needs_info is intentionally excluded — those leads asked a question, which is not
// the same as showing interest. We don't back-sync them to EmailBison's interested count.
const INTERESTED_INTENTS = new Set(["interested", "interested_urgent"]);

const SYSTEM_PROMPT = `You are a cold email reply classifier for a B2B M&A/PE outreach agency.

Return ONLY valid JSON — no markdown, no explanation:
{
  "intent": "interested_urgent"|"interested"|"needs_info"|"neutral"|"not_interested"|"unsubscribe",
  "urgency": "high"|"medium"|"low",
  "summary": "12 words max",
  "suggestedTemplateId": "t1"|"t2"|"t3"|"t4"|"t5"|"t6"|null,
  "suggestedReply": "plain text, 3-6 sentences, no placeholders"
}

INTENTS
interested_urgent: confirmed meeting, gave specific time, ready to move now
interested: any positive engagement — clear interest, OR wants more info/materials/the teaser, OR asks about the deal, valuation, structure, or process because they are weighing it (e.g. "send more info", "tell me more")
needs_info: needs a reply but has NOT shown interest — corrects a premise in the cold email, questions who you are or how you got their info, or asks a skeptical/gatekeeping question
neutral: ambiguous or non-committal
not_interested: soft no or wrong timing
unsubscribe: hard no, asks to be removed

URGENCY: high=action needed now | medium=interested, no deadline | low=info/neutral/declining

TEMPLATES: t1=Schedule call | t2=Send materials | t3=Answer their question | t4=Polite decline | t5=Follow up | t6=Confirm meeting

REPLY: Use lead's first name. Reference what they said specifically. 3-6 sentences. No subject line. No [PLACEHOLDERS].`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set in .env.local" },
      { status: 500 }
    );
  }

  const { replyId, leadName: rawLeadName, leadEmail, campaign, message } = await req.json();
  const leadName = rawLeadName?.trim() || leadEmail?.trim() || "Unknown";

  if (!message?.trim()) {
    return NextResponse.json(
      { error: "message is required" },
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
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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

    // ── Back-sync positive intent into EmailBison ────────────────────────
    if (INTERESTED_INTENTS.has(parsed.intent)) {
      try {
        const result = await backsyncInterestedToEmailBison(replyId);
        console.log("[analyze] back-sync to EmailBison:", { replyId, intent: parsed.intent, result });
      } catch (err) {
        console.error("[analyze] back-sync to EmailBison failed:", { replyId, error: (err as Error).message });
        // Non-fatal — still return the result
      }
    }
  }

  return NextResponse.json(parsed);
}
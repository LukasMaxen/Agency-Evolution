import { AIAnalysis, AIIntent, AIUrgency } from "./mock-data";

export async function analyzeReply(
  leadName: string,
  leadEmail: string,
  campaign: string,
  message: string
): Promise<AIAnalysis> {
  // Calls our own Next.js API route — no CORS, API key stays server-side
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadName, leadEmail, campaign, message }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error ?? "AI analysis failed");
  }

  const parsed = await response.json();

  return {
    intent: parsed.intent as AIIntent,
    urgency: parsed.urgency as AIUrgency,
    summary: parsed.summary ?? "",
    suggestedTemplateId: parsed.suggestedTemplateId ?? null,
    suggestedReply: parsed.suggestedReply ?? "",
    analyzedAt: new Date(),
  };
}

// Visual config for each intent
export const INTENT_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string; dotColor: string }
> = {
  interested_urgent: { label: "Urgent",        color: "#991b1b", bg: "#fef2f2", border: "#fca5a5", dotColor: "#ef4444" },
  interested:        { label: "Hot lead",       color: "#92400e", bg: "#fffbeb", border: "#fcd34d", dotColor: "#f59e0b" },
  needs_info:        { label: "Needs info",     color: "#1e40af", bg: "#eff6ff", border: "#93c5fd", dotColor: "#3b82f6" },
  neutral:           { label: "Neutral",        color: "#374151", bg: "#f9fafb", border: "#e5e7eb", dotColor: "#9ca3af" },
  not_interested:    { label: "Not interested", color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb", dotColor: "#d1d5db" },
  unsubscribe:       { label: "Unsubscribe",    color: "#6b7280", bg: "#f9fafb", border: "#e5e7eb", dotColor: "#d1d5db" },
};

// Sort priority — urgent first
export const URGENCY_ORDER: Record<string, number> = {
  interested_urgent: 0,
  interested:        1,
  needs_info:        2,
  neutral:           3,
  not_interested:    4,
  unsubscribe:       5,
};

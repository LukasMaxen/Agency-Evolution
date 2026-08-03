// Extra context lines for a booked-meeting Slack notification:
//   1. Redirect note  — if we originally emailed a different address than the one that booked.
//   2. Company        — what the company does (reuses the website-scrape summary).
//   3. ICP fit        — a one-line Yes / Partial / No judgment vs the workspace's ICP.
//
// Best-effort: every piece is independently try/caught so a failure just omits that line.

import pool from "@/lib/db";
import { resolveLeadDomain, getLeadCompanyContext } from "@/lib/fetch-lead-website";

export interface MeetingContextInput {
  workspaceSlug: string;
  leadEmail: string;
  /** Concise ICP definition for this workspace (from MEETING_CONFIG). Omit to skip ICP fit. */
  icpDescription?: string;
  /** Revenue value if we have it (from the Airtable record), fed into the ICP judgment. */
  revenue?: string | number | null;
}

function firstSentences(text: string, n = 2): string {
  const parts = (text || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return parts.slice(0, n).join(" ").slice(0, 300);
}

// The website-context summary is formatted "WHAT THEY SELL: X  CATEGORY: Y  EXIT SIGNALS: Z".
// For the meeting note we only want a tight "what they do", so pull the sell + category.
function companyLine(summary: string): string {
  const s = (summary || "").replace(/\s+/g, " ").trim();
  const sell = s.match(/WHAT THEY SELL:\s*(.+?)(?:\s*(?:CATEGORY|EXIT SIGNALS):|$)/i)?.[1]?.trim();
  const cat = s.match(/CATEGORY:\s*(.+?)(?:\s*EXIT SIGNALS:|$)/i)?.[1]?.trim();
  if (sell) return (cat ? `${sell} (${cat})` : sell).slice(0, 220);
  return firstSentences(s, 2);
}

async function assessIcpFit(icp: string, company: string, revenue?: string | number | null): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        messages: [{
          role: "user",
          content: `Our ideal customer profile (ICP):\n${icp}\n\nThe company that just booked:\n${company}${revenue ? `\nKnown revenue: ${revenue}` : ""}\n\nIs this company an ICP fit? Reply in ONE short line, starting with "Yes", "Partial", or "No", then a 4-8 word reason. No preamble.`,
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.content?.[0]?.text ?? "").trim().replace(/\s+/g, " ");
    return text ? text.slice(0, 160) : null;
  } catch {
    return null;
  }
}

/** Returns the extra context lines to append to the meeting Slack message. */
export async function buildMeetingContext(input: MeetingContextInput): Promise<string[]> {
  const lines: string[] = [];
  const email = (input.leadEmail || "").toLowerCase();
  let leadCompany = "";

  // 1. Redirect note — did the booker differ from who we originally reached out to?
  try {
    const r = await pool.query(
      `SELECT lead_email, lead_company, preferred_recipient_email
         FROM replies
        WHERE workspace_slug = $2 AND (LOWER(lead_email) = $1 OR LOWER(preferred_recipient_email) = $1)
        ORDER BY received_at DESC LIMIT 1`,
      [email, input.workspaceSlug],
    );
    const row = r.rows[0];
    if (row) {
      leadCompany = row.lead_company ?? "";
      const pref = (row.preferred_recipient_email ?? "").toLowerCase();
      const orig = (row.lead_email ?? "").toLowerCase();
      if (pref && pref === email && orig && orig !== email) {
        lines.push(`:arrows_counterclockwise: Originally reached out to ${row.lead_email}, booked by this contact.`);
      }
    }
  } catch { /* omit */ }

  // 2. What the company does.
  let companySummary = "";
  try {
    const domain = resolveLeadDomain({ leadEmail: input.leadEmail });
    if (domain) {
      const ctx = await getLeadCompanyContext(domain);
      if (ctx?.summary) companySummary = companyLine(ctx.summary);
    }
  } catch { /* omit */ }
  if (!companySummary && leadCompany) companySummary = leadCompany;
  if (companySummary) lines.push(`Company: ${companySummary}`);

  // 3. ICP fit.
  if (input.icpDescription && companySummary) {
    const fit = await assessIcpFit(input.icpDescription, companySummary, input.revenue);
    if (fit) lines.push(`ICP fit: ${fit}`);
  }

  return lines;
}

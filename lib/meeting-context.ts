// Extra context lines for a booked-meeting Slack notification:
//   1. Redirect note  — if we originally emailed a different address than the one that booked.
//   2. Company        — what the company does (reuses the website-scrape summary).
//   3. Context        — the deal nuance pulled from the actual email thread (revenue vs the
//                       buyer's criteria, what we offered, why they booked). This is the line
//                       a rep most wants walking into the call.
//   4. ICP fit        — a one-line Yes / Partial / No judgment vs the workspace's ICP.
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

// Strip the quoted reply chain so the thread we hand to the model is only the new content.
const QUOTED_RE = /(?:^|\n)[ \t>]*(?:On[\s\S]{0,200}?\bwrote:|-{2,}\s*Original Message\s*-{2,}|_{5,}|From:[ \t]*\S.*\r?\n[ \t]*(?:Sent|Date):)/i;
function stripQuoted(t: string): string {
  const raw = t || "";
  const i = raw.search(QUOTED_RE);
  return (i > 0 ? raw.slice(0, i) : raw)
    .replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull the recent back-and-forth (our sends + their replies) for the lead, oldest first. */
async function recentThread(workspaceSlug: string, emails: string[]): Promise<string> {
  const lc = emails.map(e => e.toLowerCase());
  const [rep, snt] = await Promise.all([
    pool.query(
      `SELECT received_at AS at, message AS body FROM replies
        WHERE workspace_slug = $1 AND (LOWER(lead_email) = ANY($2) OR LOWER(preferred_recipient_email) = ANY($2))`,
      [workspaceSlug, lc],
    ),
    pool.query(
      `SELECT sent_at AS at, body FROM sent_emails
        WHERE workspace_slug = $1 AND LOWER(lead_email) = ANY($2)`,
      [workspaceSlug, lc],
    ),
  ]);
  const items = [
    ...rep.rows.map((r: any) => ({ at: r.at, who: "LEAD", body: stripQuoted(r.body) })),
    ...snt.rows.map((r: any) => ({ at: r.at, who: "US", body: stripQuoted(r.body) })),
  ]
    .filter(x => x.body)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  if (!items.length) return "";
  return items.slice(-6).map(x => `${x.who}: ${x.body.slice(0, 450)}`).join("\n");
}

async function haiku(prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.content?.[0]?.text ?? "").trim().replace(/\s+/g, " ");
    return text || null;
  } catch {
    return null;
  }
}

/** One tight line on the deal context, read from the actual thread. */
async function summarizeThread(thread: string): Promise<string | null> {
  const out = await haiku(
    `Below is the recent email thread that led to a booked call. "US" = what we sent, "LEAD" = the prospect.\n\n${thread}\n\n` +
      `In ONE short line (max 20 words), give the rep the key context for this call. Prioritise: revenue numbers the lead gave, whether they fit or miss the buyer's criteria, what we offered that got them to book, or anything unusual. Start directly with the fact. No preamble, no "The lead", no trailing period needed.`,
    70,
  );
  return out ? out.slice(0, 200) : null;
}

async function assessIcpFit(icp: string, company: string, revenue?: string | number | null): Promise<string | null> {
  const text = await haiku(
    `Our ideal customer profile (ICP):\n${icp}\n\nThe company that just booked:\n${company}${revenue ? `\nKnown revenue: ${revenue}` : ""}\n\nIs this company an ICP fit? Reply in ONE short line, starting with "Yes", "Partial", or "No", then a 4-8 word reason. No preamble.`,
    60,
  );
  return text ? text.slice(0, 160) : null;
}

/** Returns the extra context lines to append to the meeting Slack message. */
export async function buildMeetingContext(input: MeetingContextInput): Promise<string[]> {
  const lines: string[] = [];
  const email = (input.leadEmail || "").toLowerCase();
  let leadCompany = "";
  const threadEmails = new Set<string>([email]);

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
      if (orig) threadEmails.add(orig);
      if (pref) threadEmails.add(pref);
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

  // 3. Deal context from the actual thread (revenue vs criteria, what we offered, why booked).
  try {
    const thread = await recentThread(input.workspaceSlug, [...threadEmails]);
    if (thread) {
      const note = await summarizeThread(thread);
      if (note) lines.push(`Context: ${note}`);
    }
  } catch { /* omit */ }

  // 4. ICP fit.
  if (input.icpDescription && companySummary) {
    const fit = await assessIcpFit(input.icpDescription, companySummary, input.revenue);
    if (fit) lines.push(`ICP fit: ${fit}`);
  }

  return lines;
}

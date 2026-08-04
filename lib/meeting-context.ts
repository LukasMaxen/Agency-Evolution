// Extra context lines for a booked-meeting Slack notification:
//   1. Redirect note  — if we originally emailed a different address than the one that booked.
//   2. Company        — what the lead's company actually sells/does.
//   3. EBITDA         — approximate, tagged with its source (stated / public info / estimate).
//   4. Context        — how the lead's business fits the buyer's criteria (about the LEAD,
//                       researched — NEVER summarized from our own sales copy).
//   5. ICP fit        — a one-line Yes / Partial / No verdict.
//
// Everything about the company is grounded in research about the lead (web search + the
// lead's own words + a site scrape), never in what we wrote to them. A failed site scrape
// must never leak into the note; it falls back to research, the lead's stated company, or
// the line is dropped. Best-effort: every piece is independently try/caught.

import pool from "@/lib/db";
import { resolveLeadDomain, getLeadCompanyContext } from "@/lib/fetch-lead-website";

export interface MeetingContextInput {
  workspaceSlug: string;
  leadEmail: string;
  /** Concise ICP / buyer definition for this workspace. Present only for M&A workspaces. */
  icpDescription?: string;
  /** Revenue value if we have it (from the Airtable record). */
  revenue?: string | number | null;
}

// ── low-level helpers ────────────────────────────────────────────────────────
const QUOTED_RE = /(?:^|\n)[ \t>]*(?:On[\s\S]{0,200}?\bwrote:|-{2,}\s*Original Message\s*-{2,}|_{5,}|From:[ \t]*\S.*\r?\n[ \t]*(?:Sent|Date):)/i;
function stripQuoted(t: string): string {
  const raw = t || "";
  const i = raw.search(QUOTED_RE);
  return (i > 0 ? raw.slice(0, i) : raw).replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").replace(/\s+/g, " ").trim();
}

// A site scrape that returned no usable content (parked page, JS shell, CSS-only, etc.).
// Its text must never be shown as the company description.
function looksLikeFailure(s: string): boolean {
  const t = (s || "").toLowerCase();
  if (!t.trim()) return true;
  return /cannot determine|could not determine|unable to (determine|verify|find|identify)|non-functional|css framework|no real (website )?content|no meaningful content|not enough (information|content)|framework noise|appears to be (empty|a parked|non)|only (css|navigation|boilerplate)|placeholder|i (can't|cannot) (tell|see)/.test(t);
}

function normalizeAmt(s: string): string {
  const t = (s || "").trim().replace(/^~/, "");
  return t.startsWith("$") ? t : `$${t}`;
}

async function haiku(prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.content?.[0]?.text ?? "").trim().replace(/\s+/g, " ");
    return text || null;
  } catch {
    return null;
  }
}

/** The lead's OWN messages (never ours) — a grounding hint for research. */
async function leadThreadText(workspaceSlug: string, emails: string[]): Promise<string> {
  const lc = emails.map(e => e.toLowerCase());
  const rep = await pool.query(
    `SELECT message AS body FROM replies
      WHERE workspace_slug = $1 AND (LOWER(lead_email) = ANY($2) OR LOWER(preferred_recipient_email) = ANY($2))
      ORDER BY received_at`,
    [workspaceSlug, lc],
  );
  const items = rep.rows.map((r: any) => stripQuoted(r.body)).filter(Boolean);
  if (!items.length) return "";
  return items.slice(-4).map((b: string) => b.slice(0, 400)).join("\n---\n");
}

function grab(out: string, label: string): string | null {
  const m = out.match(new RegExp(`${label}:\\s*(.+?)(?:\\s+(?:COMPANY|EBITDA|CONTEXT|ICP FIT):|$)`, "i"));
  const v = m?.[1]?.trim();
  if (!v) return null;
  return /^(n\/?a|unknown|none|n\/a\.)\.?$/i.test(v) ? null : v.slice(0, 220);
}

// Pull a clean "what they sell" line out of a good site-scrape summary (formatted
// "WHAT THEY SELL: X  CATEGORY: Y  EXIT SIGNALS: Z"). Returns null for a failed scrape.
function companyFromSummary(summary: string): string | null {
  if (looksLikeFailure(summary)) return null;
  const s = (summary || "").replace(/\s+/g, " ").trim();
  const sell = s.match(/WHAT THEY SELL:\s*(.+?)(?:\s*(?:CATEGORY|EXIT SIGNALS):|$)/i)?.[1]?.trim();
  const cat = s.match(/CATEGORY:\s*(.+?)(?:\s*EXIT SIGNALS:|$)/i)?.[1]?.trim();
  if (sell) return (cat ? `${sell} (${cat})` : sell).slice(0, 220);
  const first = s.split(/(?<=[.!?])\s+/)[0];
  return first && first.length < 200 ? first : null;
}

interface LeadEnrichment { company: string | null; ebitda: string | null; context: string | null; icpFit: string | null; }

// One web-search-backed call that researches the LEAD and returns all four lines.
async function enrichLead(o: { company: string; domain?: string; leadSaid?: string; scraped?: string; icp?: string }): Promise<LeadEnrichment> {
  const facts = [
    o.company ? `Company name: ${o.company}` : "",
    o.domain ? `Website: ${o.domain}` : "",
    o.leadSaid ? `What the lead said about their OWN business (use this, it is about them):\n${o.leadSaid}` : "",
    (o.scraped && !looksLikeFailure(o.scraped)) ? `Notes scraped from their site: ${o.scraped}` : "",
    o.icp ? `The buyer we represent is looking for: ${o.icp}` : "",
  ].filter(Boolean).join("\n");

  const ask =
    `You are writing a short briefing for a sales rep about a company that just booked a call. Base everything on the ` +
    `COMPANY itself and what the LEAD said about themselves, plus anything you already know about this company. NEVER ` +
    `describe our own outreach or sales pitch.\n\n${facts}\n\n` +
    `Return EXACTLY these four lines, nothing else, no preamble, no markdown:\n` +
    `COMPANY: one short line on what they actually sell or do, with a category in parentheses. Write "unknown" ONLY if you genuinely have nothing to go on.\n` +
    `EBITDA: approximate annual EBITDA as "<amount> | <source>", amount like ~$4M, source one of "stated in thread" / "from public info" / "from revenue" / "rough estimate". "n/a" only if impossible.\n` +
    `CONTEXT: one short line (max 16 words) on how THIS company fits (or misses) the buyer's criteria and why. About the lead's business, never our pitch.\n` +
    `ICP FIT: start with Yes, Partial, or No, then a 4-8 word reason.`;

  const out = await haiku(ask, 340);
  if (!out) return { company: null, ebitda: null, context: null, icpFit: null };

  let ebitda: string | null = null;
  const rawEb = grab(out, "EBITDA");
  if (rawEb) {
    const m = rawEb.match(/(~?\$?\s?[\d][\d.,]*\s?[kmbKMB]?)\s*\|\s*([a-zA-Z ]+)/);
    if (m) {
      const amt = normalizeAmt(m[1].replace(/\s+/g, ""));
      const src = m[2].toLowerCase();
      const tag = (src.includes("stated") && src.includes("thread")) ? "stated in thread"
                : src.includes("revenue") ? "est. from revenue"
                : (src.includes("public") || src.includes("online") || src.includes("info")) ? "est. from public info"
                : "rough estimate";
      ebitda = `~${amt} (${tag})`;
    } else {
      const a = rawEb.match(/~?\$?\s?[\d][\d.,]*\s?[kmbKMB]?/);
      if (a) ebitda = `~${normalizeAmt(a[0].replace(/\s+/g, ""))} (rough estimate)`;
    }
  }

  return { company: grab(out, "COMPANY"), ebitda, context: grab(out, "CONTEXT"), icpFit: grab(out, "ICP FIT") };
}

/** Returns the extra context lines to append to the meeting Slack message. */
export async function buildMeetingContext(input: MeetingContextInput): Promise<string[]> {
  const lines: string[] = [];
  const email = (input.leadEmail || "").toLowerCase();
  const domain = resolveLeadDomain({ leadEmail: input.leadEmail }) || undefined;
  let leadCompany = "";
  const threadEmails = new Set<string>([email]);

  // 1. Redirect note.
  try {
    const r = await pool.query(
      `SELECT lead_email, lead_company, preferred_recipient_email FROM replies
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

  // Link the lead's thread when they booked from a different address than we emailed (same
  // person, different domain — e.g. wassim.kari@loolia.com vs wassim.kari@parallel-holding.com).
  // Match by a specific email local-part so we can still surface what the lead told us.
  try {
    const local = email.split("@")[0] || "";
    const generic = /^(info|sales|contact|admin|hello|team|office|support|marketing|founders?|ceo|hi|no-?reply)$/i.test(local);
    if (local.length > 4 && !generic) {
      const r2 = await pool.query(
        `SELECT LOWER(lead_email) AS e, lead_company FROM replies
          WHERE workspace_slug = $1 AND split_part(LOWER(lead_email), '@', 1) = $2
          ORDER BY received_at DESC LIMIT 5`,
        [input.workspaceSlug, local.toLowerCase()],
      );
      for (const row of r2.rows) {
        if (row.e) threadEmails.add(row.e);
        if (!leadCompany && row.lead_company) leadCompany = row.lead_company;
      }
    }
  } catch { /* omit */ }

  // Site scrape — a hint only. Never shown directly if it failed.
  let scraped = "";
  try { if (domain) { const ctx = await getLeadCompanyContext(domain); if (ctx?.summary) scraped = ctx.summary; } } catch { /* omit */ }

  if (input.icpDescription) {
    // M&A workspaces: full research-backed enrichment about the lead.
    let leadSaid = "";
    try { leadSaid = await leadThreadText(input.workspaceSlug, [...threadEmails]); } catch { /* omit */ }
    const e = await enrichLead({ company: leadCompany || domain || email, domain, leadSaid, scraped, icp: input.icpDescription });
    const company = e.company || companyFromSummary(scraped) || (leadCompany || null);
    if (company) lines.push(`Company: ${company}`);
    if (e.ebitda) lines.push(`EBITDA: ${e.ebitda}`);
    if (e.context) lines.push(`Context: ${e.context}`);
    if (e.icpFit) lines.push(`ICP fit: ${e.icpFit}`);
  } else {
    // Non-M&A workspaces: just what the company does.
    const company = companyFromSummary(scraped) || (leadCompany || null);
    if (company) lines.push(`Company: ${company}`);
  }

  return lines;
}

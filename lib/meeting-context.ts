// Extra context lines for a booked-meeting Slack notification:
//   1. Redirect note (if we originally emailed a different address than the one that booked)
//   2. Company (what the lead's company actually sells/does, and how well it fits the buyer's
//      criteria, in one line, researched, never summarized from our own sales copy)
//   3. EBITDA (approximate, tagged with its source: stated / public info / estimate)
//
// The Website line itself is added separately in meetings-tracker.ts (booking answer, record,
// or email domain), so the reader can judge fit themselves instead of only trusting this note.
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
  /** Booking phone — its country code helps the research disambiguate the company. */
  phone?: string;
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
  const m = out.match(new RegExp(`${label}:\\s*(.+?)(?:\\s+(?:COMPANY|EBITDA):|$)`, "i"));
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

interface LeadEnrichment { company: string | null; }

// Company (what + fit merged into one line) — PLAIN Haiku (no tools), so the strict format is
// reliable. It is the FALLBACK used only when the web-search researchLead call is unavailable.
// (Kept short; the web-search path handles EBITDA + company lookup.) Its verbose output can
// never disturb this line.
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
    `Return EXACTLY this line, nothing else, no preamble, no markdown:\n` +
    `COMPANY: one line (max 30 words) on what they actually sell or do, with a category in parentheses, then how well ` +
    `they fit the buyer's criteria and why. About the lead's business, never our pitch. Write "unknown" ONLY if you ` +
    `genuinely have nothing to go on.`;

  const out = await haiku(ask, 180);
  if (!out) return { company: null };
  return { company: grab(out, "COMPANY") };
}

// Haiku with the web_search tool enabled. Used ONLY for the EBITDA lookup.
async function haikuWithSearch(prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ").trim().replace(/\s+/g, " ");
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface LeadResearch { company: string | null; ebitda: string | null; }

// Pull one labelled value out of a possibly-verbose web-search answer. Takes the LAST
// occurrence of the label (so search narration earlier in the text is ignored) and cuts it
// at whichever of the other labels comes next.
function pickBlock(out: string, label: string, nextLabels: string[]): string | null {
  const up = out.toUpperCase();
  const i = up.lastIndexOf(label.toUpperCase() + ":");
  if (i < 0) return null;
  let seg = out.slice(i + label.length + 1);
  let cut = seg.length;
  for (const n of nextLabels) {
    const j = seg.toUpperCase().indexOf(n.toUpperCase() + ":");
    if (j >= 0 && j < cut) cut = j;
  }
  seg = seg.slice(0, cut).trim().replace(/^["'\-\s]+|["'\s]+$/g, "");
  return seg && !/^(none|unknown|n\/?a)\b/i.test(seg) ? seg.slice(0, 220) : null;
}

// PRIMARY enrichment: actually look the company up on the web every time. Returns all four
// lines, parsed tolerantly. null if the search itself was unavailable (→ plain-Haiku fallback).
async function researchLead(o: { company: string; domains?: string[]; domain?: string; leadSaid?: string; scraped?: string; icp?: string; phone?: string }): Promise<LeadResearch | null> {
  const domainList = (o.domains && o.domains.length ? o.domains : (o.domain ? [o.domain] : []));
  const facts = [
    o.company ? `Company name / identifier: ${o.company}` : "",
    domainList.length ? `Company email/website domain(s): ${domainList.join(", ")}` : "",
    o.phone ? `Contact phone (country tells you where they operate): ${o.phone}` : "",
    o.leadSaid ? `What the lead said about their own business: ${o.leadSaid}` : "",
    (o.scraped && !looksLikeFailure(o.scraped)) ? `Notes scraped from their site: ${o.scraped}` : "",
    o.icp ? `The buyer we represent is looking for: ${o.icp}` : "",
  ].filter(Boolean).join("\n");

  const ask =
    `You are researching a company that just booked a sales call, to brief the rep. Use web search to find what ` +
    `this company actually is and does, plus any public revenue or EBITDA. Actually look it up — do not rely only on ` +
    `the notes below, and never describe our own outreach.\n\n` +
    `IMPORTANT: identify the SPECIFIC company from the domain(s) and what the lead said. The brand/store domain is the ` +
    `strongest signal; a holding-company domain is weaker. Do NOT confuse it with a similarly-named company in another ` +
    `country — cross-check against the lead's description and the phone's country. If sources conflict or you are not ` +
    `confident which company it is, say so in COMPANY and keep it to what the lead actually told you.\n\n${facts}\n\n` +
    `When you are done searching, end your reply with EXACTLY this block and nothing after it:\n` +
    `COMPANY: <one line (max 30 words) on what they really sell or do, with a category in parentheses, then how well ` +
    `they fit or miss the buyer's criteria and why, about the lead's business>\n` +
    `EBITDA: <~$amount | from public info OR from revenue OR stated in thread — or the single word none>`;

  const out = await haikuWithSearch(ask, 1400);
  if (!out) return null;

  const company = pickBlock(out, "COMPANY", ["EBITDA"]);
  const ebRaw = pickBlock(out, "EBITDA", []);
  if (!company && !ebRaw) return null; // unparseable → fall back

  let ebitda: string | null = null;
  if (ebRaw) {
    const m = ebRaw.match(/(~?\$?\s?[\d][\d.,]*\s?[kmbKMB]?)\s*\|\s*([a-zA-Z ]+)/);
    if (m) {
      const amt = normalizeAmt(m[1].replace(/\s+/g, ""));
      const src = m[2].toLowerCase();
      const tag = (src.includes("stated") && src.includes("thread")) ? "stated in thread"
                : src.includes("revenue") ? "est. from revenue"
                : "from public info";
      ebitda = `~${amt} (${tag})`;
    } else {
      const a = ebRaw.match(/~?\$?\s?[\d][\d.,]*\s?[kmbKMB]?/);
      if (a) ebitda = `~${normalizeAmt(a[0].replace(/\s+/g, ""))} (from public info)`;
    }
  }
  return { company, ebitda, context, icpFit };
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
    const companyForLookup = leadCompany || domain || email;
    // All non-freemail domains across the lead's linked addresses — the brand/store domain
    // (e.g. loolia.com) is a far stronger identifier than a holding-company booking domain.
    const FREEMAIL = new Set(["gmail.com", "hotmail.com", "yahoo.com", "outlook.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "live.com", "msn.com", "me.com", "mail.com"]);
    const domains = [...new Set([...threadEmails].map(e => e.split("@")[1]).filter((d): d is string => !!d && !FREEMAIL.has(d)))];
    // Primary: research the company on the web. Fallback: plain Haiku if search is unavailable.
    let r = await researchLead({ company: companyForLookup, domains, domain, leadSaid, scraped, icp: input.icpDescription, phone: input.phone });
    if (!r) {
      const e = await enrichLead({ company: companyForLookup, domain, leadSaid, scraped, icp: input.icpDescription });
      r = { company: e.company, ebitda: null, context: e.context, icpFit: e.icpFit };
    }
    const company = r.company || companyFromSummary(scraped) || (leadCompany || null);
    if (company) lines.push(`Company: ${company}`);
    if (r.ebitda) lines.push(`EBITDA: ${r.ebitda}`);
    if (r.context) lines.push(`Context: ${r.context}`);
    if (r.icpFit) lines.push(`ICP fit: ${r.icpFit}`);
  } else {
    // Non-M&A workspaces: just what the company does.
    const company = companyFromSummary(scraped) || (leadCompany || null);
    if (company) lines.push(`Company: ${company}`);
  }

  // No em/en dashes anywhere in output (house rule) — swap them for commas.
  return lines.map(l => l.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ","));
}

// Extra context lines for a booked-meeting Slack notification:
//   1. Redirect note (if we originally emailed a different address than the one that booked)
//   2. Context (M&A workspaces only, e.g. Larsen/Acceler8rs/internal-campaigns): ONE line on
//      what the lead actually said in the thread about their business, situation, or revenue,
//      and why they booked. Grounded ONLY in the thread, never web-researched or guessed.
//      (2026-08-19: replaced the old researched "Company" line, which read as marketing fluff
//      -- Kasper: "no BS".)
//   3. EBITDA (approximate, tagged with its source: stated / public info / estimate) -- this
//      one IS researched via web search, since it self-discloses its source instead of
//      asserting fact.
//
// The Website line itself is added separately in meetings-tracker.ts (booking answer, record,
// or email domain), so the reader can judge fit themselves instead of only trusting this note.
//
// Best-effort: every piece is independently try/caught.

import pool from "@/lib/db";
import { resolveLeadDomain, getLeadCompanyContext } from "@/lib/fetch-lead-website";
import { OPPOSITE_WORKSPACE } from "@/lib/larsen-cross-blacklist";

export interface MeetingContextInput {
  workspaceSlug: string;
  leadEmail: string;
  /** Concise ICP / buyer definition for this workspace. Present only for M&A workspaces. */
  icpDescription?: string;
  /**
   * When true (with icpDescription set), adds an "ICP fit: Yes/No, <=5 word reason" line,
   * researched in the same web-search call as EBITDA. Kept separate from icpDescription's
   * presence so turning this on for WithPebble/AEO Consulting doesn't change the Larsen/
   * Acceler8rs/internal-campaigns card format, which only uses icpDescription to help the
   * EBITDA lookup disambiguate the company.
   */
  icpFitCheck?: boolean;
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

/** The lead's OWN messages (never ours) — a grounding hint for research. Larsen/Acceler8rs
 *  share one lead universe (see lib/larsen-cross-blacklist.ts), so a lead can have replied
 *  under the sibling workspace_slug rather than the one the meeting was booked under -- pull
 *  both so real thread content (e.g. a stated EBITDA/revenue reply) is never missed. */
async function leadThreadText(workspaceSlug: string, emails: string[]): Promise<string> {
  const lc = emails.map(e => e.toLowerCase());
  const slugs = [workspaceSlug, ...(OPPOSITE_WORKSPACE[workspaceSlug] ? [OPPOSITE_WORKSPACE[workspaceSlug]] : [])];
  const rep = await pool.query(
    `SELECT message AS body FROM replies
      WHERE workspace_slug = ANY($1) AND (LOWER(lead_email) = ANY($2) OR LOWER(preferred_recipient_email) = ANY($2))
      ORDER BY received_at`,
    [slugs, lc],
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

// Context line -- PLAIN Haiku (no tools, no web search). Grounded ONLY in what the lead
// literally wrote in the thread, never researched or guessed. Replaces the old web-searched
// "Company" line (2026-08-19, Kasper: "no BS").
async function threadContext(leadSaid: string): Promise<string | null> {
  if (!leadSaid) return null;
  const ask =
    `Below is what a lead actually wrote to us in an email thread, before booking a call. Write ONE line ` +
    `(max 30 words) briefing a sales rep on what's useful going into the call: what the lead said about ` +
    `their business, situation, or revenue if stated, what they asked us, what we told them, or why they ` +
    `booked, using ONLY what is in the thread below. Do not research, guess, or add anything not stated ` +
    `there. Never characterize the lead's intent or motivation (e.g. "seeking acquisition", "wants to ` +
    `sell") unless they said so in those words -- if they only asked a question, report the question, not ` +
    `an inferred reason for it.\n\n` +
    `THREAD:\n${leadSaid}\n\n` +
    `Return EXACTLY this line, nothing else, no preamble, no markdown. Only write "none" if the thread is ` +
    `pure scheduling logistics with nothing else in it.\nCONTEXT: <line or none>`;

  const out = await haiku(ask, 150);
  if (!out) return null;
  // Haiku sometimes skips the "CONTEXT:" prefix and replies with just the line (or bare
  // "none") -- fall back to the raw output so real content is never dropped over a format slip.
  const v = grab(out, "CONTEXT") ?? out.trim();
  return v && !/^none\.?$/i.test(v) ? v.slice(0, 220) : null;
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

interface LeadResearch { ebitda: string | null; icpFit: string | null; }

// Formats a raw "Yes, some reason here" / "No, some reason" model answer into a clean
// "Yes, <=5 words>" line -- enforced in code since a max-5-words instruction alone isn't
// reliable. Returns null if the answer doesn't parse as a clear Yes/No.
function formatIcpFit(raw: string): string | null {
  const m = raw.match(/^(Yes|No)\b[,.\s]*(.*)$/i);
  if (!m) return null;
  const verdict = /^yes/i.test(m[1]) ? "Yes" : "No";
  const reason = m[2].trim().replace(/^[-,.\s]+|[.\s]+$/g, "");
  const words = reason.split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
  return words ? `${verdict}, ${words}` : verdict;
}

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

  const icpTask = o.icp
    ? `\nTASK 2 - ICP FIT. Here is what we're looking for in a company for this offer:\n${o.icp}\n\n` +
      `Based on your web research into the company AND what they said in the correspondence above (if given), ` +
      `decide whether they are a genuine fit. You must answer "Yes" or "No", always pick one, never "partial" ` +
      `or "unsure" -- use your judgment on a genuine edge case, but commit to a side. Then give a reason in 5 ` +
      `words or fewer, no more. Ground the reason in an actual fact you found or that they stated (their ` +
      `industry, size, what they sell, who they serve), never a generic assumption or a restatement of the ICP ` +
      `itself.\n`
    : "";

  const ask =
    `You are researching a company that just booked a sales call. Use web search to check.\n\n` +
    `IMPORTANT: identify the SPECIFIC company from the domain(s) and what the lead said. The brand/store domain is the ` +
    `strongest signal; a holding-company domain is weaker. Do NOT confuse it with a similarly-named company in another ` +
    `country, cross-check against the lead's description and the phone's country.\n\n${facts}\n\n` +
    `TASK 1 - EBITDA. Only report a number if you find one of these:\n` +
    `  (a) an EBITDA figure actually disclosed publicly for this exact company (filing, press release, ` +
    `credible business database), or\n` +
    `  (b) a specific dollar EBITDA figure the LEAD stated themselves in the thread above.\n` +
    `A multiple alone (e.g. "18x EBITDA") is NOT a figure -- never multiply it against a revenue estimate, ` +
    `industry margin assumption, or any other number to derive one. NEVER estimate or back-calculate EBITDA ` +
    `from revenue or any indirect signal. Saying "none" is the correct, expected answer for most private ` +
    `companies -- most have no public EBITDA and it is far better to omit than to guess.\n` +
    `${icpTask}\n` +
    `When you are done searching, end your reply with EXACTLY these line(s) and nothing after:\n` +
    `EBITDA: <~$amount (from public info) OR ~$amount (stated in thread) OR the single word none>` +
    (o.icp ? `\nICP_FIT: <Yes or No>, <reason, 5 words or fewer>` : "");

  const out = await haikuWithSearch(ask, 800);
  if (!out) return null;

  const ebRaw = pickBlock(out, "EBITDA", o.icp ? ["ICP_FIT"] : []);
  let ebitda: string | null = null;
  if (ebRaw && !/^none\.?$/i.test(ebRaw)) {
    const m = ebRaw.match(/(~?\$[\d][\d.,]*\s?[kmbKMB]?)\s*\(([^)]+)\)/);
    if (m) {
      const amt = normalizeAmt(m[1].replace(/\s+/g, ""));
      const tag = /stated/i.test(m[2]) ? "stated in thread" : "from public info";
      ebitda = `~${amt} (${tag})`;
    } else {
      const a = ebRaw.match(/~?\$[\d][\d.,]*\s?[kmbKMB]?/);
      if (a) ebitda = `~${normalizeAmt(a[0].replace(/\s+/g, ""))} (from public info)`;
    }
  }

  // pickBlock's "none/unknown/n/a" guard doesn't false-positive on a genuine "No, ..." answer
  // (it matches the literal word "none", not "no"), so it's safe to reuse here.
  const icpRaw = o.icp ? pickBlock(out, "ICP_FIT", []) : null;
  const icpFit = icpRaw ? formatIcpFit(icpRaw) : null;

  return { ebitda, icpFit };
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
  // Requires a separator (firstname.lastname-shaped) -- a bare first name like "amanda" is a
  // common collision across unrelated leads and must never be used to pull in someone else's
  // thread content. Confirmed live 2026-08-20: bare "amanda" pulled a different Amanda's
  // "I would love to sell my brand" message into Thomson & Scott's meeting card.
  try {
    const local = email.split("@")[0] || "";
    const generic = /^(info|sales|contact|admin|hello|team|office|support|marketing|founders?|ceo|hi|no-?reply)$/i.test(local);
    const hasSeparator = /[._-]/.test(local);
    if (local.length > 4 && hasSeparator && !generic) {
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
    // M&A workspaces: Context is thread-only, never researched. EBITDA is still
    // research-backed since it self-discloses its source instead of asserting fact.
    let leadSaid = "";
    try { leadSaid = await leadThreadText(input.workspaceSlug, [...threadEmails]); } catch { /* omit */ }
    const companyForLookup = leadCompany || domain || email;
    // All non-freemail domains across the lead's linked addresses — the brand/store domain
    // (e.g. loolia.com) is a far stronger identifier than a holding-company booking domain.
    const FREEMAIL = new Set(["gmail.com", "hotmail.com", "yahoo.com", "outlook.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "live.com", "msn.com", "me.com", "mail.com"]);
    const domains = [...new Set([...threadEmails].map(e => e.split("@")[1]).filter((d): d is string => !!d && !FREEMAIL.has(d)))];
    const [context, r] = await Promise.all([
      threadContext(leadSaid),
      researchLead({ company: companyForLookup, domains, domain, leadSaid, scraped, icp: input.icpDescription, phone: input.phone }),
    ]);
    if (context) lines.push(`Context: ${context}`);
    if (input.icpFitCheck && r?.icpFit) lines.push(`ICP fit: ${r.icpFit}`);
    if (r?.ebitda) lines.push(`EBITDA: ${r.ebitda}`);
  } else {
    // Non-M&A workspaces: just what the company does.
    const company = companyFromSummary(scraped) || (leadCompany || null);
    if (company) lines.push(`Company: ${company}`);
  }

  // No em/en dashes anywhere in output (house rule) — swap them for commas.
  return lines.map(l => l.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ","));
}

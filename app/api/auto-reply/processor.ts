import pool from "@/lib/db";
import fs from "fs";
import path from "path";
import {
  REPLY_APPROVAL_CHANNEL,
  MANUAL_REPLIES_CHANNEL,
  approvalChannelFor,
  postToSlack as postToSlackShared,
  approvalFooterBlock,
  quoteForSlack,
  slugToName as slugToNameShared,
  sanitizeDashes,
  normalizeSignature,
} from "@/lib/slack-approval";
import { checkRateLimit } from "@/lib/rate-limiter";
import { backsyncInterestedToEmailBison } from "@/lib/emailbison-backsync";
import { CALENDLY_CLIENT_CONFIG } from "@/lib/calendly";
import { inferLeadTimezone, lookupCategoryForDomain } from "@/lib/lead-timezone";
import {
  suggestSlotsForClient,
  buildLiveCalendarBlock,
  CALENDLY_SLOT_PROMPT_RULE,
} from "@/lib/calendly-slot-suggestions";
import { getLeadCompanyContext, resolveLeadDomain } from "@/lib/fetch-lead-website";
import { sanitizeJsonControlChars } from "@/lib/utils";
import { containsBannedCaseStudy } from "@/lib/banned-case-studies";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AutoReplyResult {
  questions_to_answer?: string[];
  personal_hook?: string;
  pivot_line?: string;
  action: "auto_send" | "manual" | "do_nothing";
  intent: string;
  fu_sequence_type: "full" | "abbreviated" | "none";
  reply_body?: string;
  manual_reason?: string;
  flag_unsubscribe: boolean;
  flag_meeting_booked: boolean;
  recipient_email?: string;
  recipient_name?: string;
  cc_emails?: string[];
}

// ─── Client file aliases ───────────────────────────────────────────────────────

const CLIENT_FILE_ALIASES: Record<string, string> = {
  "internal-campaigns": "agency-evolution",
  // Acceler8rs accounts now represent Larsen Digital (2026-07-22). The only difference
  // from the larsen-digital workspace is the sender signature, which the
  // {SENDER_EMAIL_SIGNATURE} variable resolves correctly. So acceler8rs draws Larsen's
  // wording, case studies, links, and rules from the larsen-digital client file + extras.
  "acceler8rs": "larsen-digital",
};

// Workspaces that skip auto-reply entirely (handled externally, churned, or excluded).
// sonaro-ai removed 2026-06-17: onboarded onto bot. Approval channel routed to
// C0BATJ48BL3 (#reply-management) via workspaces.slack_approval_channel column.
const SKIP_WORKSPACES = new Set(["itg-group", "sro-consulting"]);

// Minimum 2000 — replies load up to 8 thread messages + system prompt + client file.
// Below 2000, Claude truncates mid-reply and the 80-char body guard routes everything to manual.
// 3000 gives headroom for the reasoning fields (questions_to_answer, personal_hook, pivot_line).
const CLAUDE_MAX_TOKENS = 5000;

// ─── File helpers ──────────────────────────────────────────────────────────────

function readFile(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf-8"); }
  catch { return ""; }
}

/**
 * Loads per-workspace learnings appended to the system prompt at runtime.
 * Lives at prompts/extras/<slug>.md so the weekly-review apply handler can
 * commit accumulated feedback patterns here without modifying the core
 * system prompt or the client file. Returns "" if no extras file exists.
 */
function readWorkspaceExtras(workspaceSlug: string): string {
  const slug = CLIENT_FILE_ALIASES[workspaceSlug] ?? workspaceSlug;
  return readFile(path.join(process.cwd(), "prompts", "extras", `${slug}.md`)).trim();
}

/**
 * Extracts only the ## REPLY QUICK REFERENCE section from a client file.
 * This keeps input tokens minimal — Claude gets exactly what it needs, nothing more.
 */
function extractQuickReference(clientFileContent: string): string {
  const marker = "## REPLY QUICK REFERENCE";
  const start = clientFileContent.indexOf(marker);
  if (start === -1) return clientFileContent.slice(0, 2000); // fallback: first 2000 chars

  // Find the next ## heading after the quick reference
  const rest = clientFileContent.slice(start + marker.length);
  const nextHeading = rest.search(/\n## /);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  return marker + section.trim();
}

// ─── Recent approved examples ─────────────────────────────────────────────────
//
// Pulls the most recent sent replies for a workspace and formats them as
// in-context positive examples. Every approved + sent reply becomes a
// training signal at draft time, not just retrospectively in the daily
// review. Excludes the current lead so we never echo the same lead back
// to themselves. Capped at 3 examples × ~1200 chars each ≈ 1k tokens.

async function fetchRecentApprovedExamples(
  workspaceSlug: string,
  excludeLeadEmail: string | null,
  limit: number = 3
): Promise<string> {
  try {
    const r = await pool.query<{
      sent_at: Date;
      lead_company: string | null;
      inbound: string;
      sent_body: string;
      subject: string | null;
    }>(
      `SELECT se.sent_at,
              r.lead_company,
              r.message AS inbound,
              se.body   AS sent_body,
              r.subject
       FROM sent_emails se
       JOIN replies r ON r.id = se.reply_id
       WHERE se.workspace_slug = $1
         AND se.sent_at > NOW() - INTERVAL '14 days'
         AND ($2::text IS NULL OR r.lead_email <> $2)
         AND COALESCE(r.message, '') <> ''
         AND COALESCE(se.body, '') <> ''
       ORDER BY se.sent_at DESC
       LIMIT $3`,
      [workspaceSlug, excludeLeadEmail, limit]
    );
    // Drop any past reply that referenced a now-deactivated case study. Without this
    // filter, a reply sent before a case study was banned keeps getting fed back as a
    // "match this voice" example for up to 14 days, re-seeding the banned name into new
    // drafts long after the ban (the exact reason KyiKyi/Headwaters kept resurfacing).
    const cleanRows = r.rows.filter(row => !containsBannedCaseStudy(row.sent_body || ""));
    if (cleanRows.length === 0) return "";

    const examples = cleanRows.map((row, i) => {
      const inbound = (row.inbound || "")
        .replace(/On \w+,? \w+ \d+,? \d{4}[\s\S]*/, "")
        .split("\n")
        .filter(line => !line.trimStart().startsWith(">"))
        .join("\n")
        .trim()
        .slice(0, 600);
      const sent = (row.sent_body || "").trim().slice(0, 1000);
      const company = row.lead_company ? ` (${row.lead_company})` : "";
      return `--- Example ${i + 1}${company} ---
LEAD INBOUND:
${inbound}

OUR APPROVED REPLY (sent):
${sent}`;
    }).join("\n\n");

    return `POSITIVE EXAMPLES (the last ${cleanRows.length} approved replies for this workspace, match this voice and structure unless the current lead's situation requires deviating, do NOT copy specifics verbatim, learn the pattern):

${examples}

`;
  } catch (err: any) {
    // Examples are a nice-to-have. Never block draft generation on a query failure.
    console.error(`[positive-examples] fetch failed for ${workspaceSlug}:`, err?.message ?? err);
    return "";
  }
}

// ─── Lead enrichment fetch ─────────────────────────────────────────────────────

async function fetchLeadEnrichment(instanceUrl: string, apiKey: string, leadId: number | string | null): Promise<string> {
  if (!leadId || !instanceUrl || !apiKey) return "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    let res: Response;
    try {
      res = await fetch(`${instanceUrl}/api/leads/${leadId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return "";
    const data = await res.json();
    const lead = data?.data;
    if (!lead) return "";

    const vars: Record<string, string> = {};
    for (const v of (lead.custom_variables ?? [])) {
      if (v.value) vars[(v.name as string).toLowerCase()] = String(v.value);
    }

    const lines: string[] = [];
    const location = [vars.city, vars.state].filter(Boolean).join(", ");
    if (location) lines.push(`Location: ${location}`);
    if (vars.employees) lines.push(`Company size: ${vars.employees} employees`);
    if (vars.linkedin) lines.push(`LinkedIn: ${vars.linkedin}`);
    if (vars.website) lines.push(`Website: ${vars.website}`);

    return lines.length > 0 ? `LEAD CONTEXT (use at least one of these facts to personalize the reply):\n${lines.join("\n")}` : "";
  } catch {
    return "";
  }
}

// ─── EmailBison thread fetch ───────────────────────────────────────────────────
// Reads the full conversation directly from EB so manual replies Kasper sends
// inside EmailBison are visible to the processor (they never reach sent_emails).

function stripHtmlForThread(s: string): string {
  return (s || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchEBThread(
  instanceUrl: string,
  apiKey: string,
  leadEmail: string,
  currentEbReplyId: string | number | null
): Promise<{ messages: Array<{ dir: "inbound" | "outbound"; sent_at: string; body: string }>; coldEmailBody: string | null }> {
  const empty = { messages: [], coldEmailBody: null };
  if (!instanceUrl || !apiKey || !leadEmail) return empty;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(
        `${instanceUrl}/api/replies?per_page=50&search=${encodeURIComponent(leadEmail)}`,
        { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, signal: ctrl.signal }
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return empty;
    const data = await res.json();
    const items: any[] = (data?.data ?? []).sort(
      (a: any, b: any) =>
        new Date(a.date_received || a.date_sent || 0).getTime() -
        new Date(b.date_received || b.date_sent || 0).getTime()
    );

    const messages = items
      .filter((item: any) => currentEbReplyId == null || String(item.id) !== String(currentEbReplyId))
      .map((item: any) => {
        const isSent = item.folder === "Sent";
        const raw = item.text_body ? item.text_body : stripHtmlForThread(item.html_body || "");
        // Trim the quoted-reply chain. Match a REAL attribution header only — a
        // Gmail/Apple "On <date> ... wrote:" line, an Outlook "Original Message"
        // divider, or a "From:/Sent:" header block — anchored to a line start.
        // Previously a bare "|wrote:" alternative matched the word anywhere in the
        // lead's own text and chopped real content, leaving the thread fragmentary
        // and out of order to the drafter (root cause of the garbled-reply report,
        // 2026-07-22).
        const cutAt = raw.search(
          /(?:^|\n)\s*(?:On[\s\S]{0,200}?\bwrote:|-{2,}\s*Original Message\s*-{2,}|From:\s[\s\S]{0,200}?\nSent:\s)/i
        );
        const body = (cutAt > 0 ? raw.slice(0, cutAt) : raw).trim();
        return {
          dir: (isSent ? "outbound" : "inbound") as "inbound" | "outbound",
          sent_at: item.date_received || item.date_sent || new Date().toISOString(),
          body,
        };
      });

    const firstSent = messages.find(m => m.dir === "outbound");
    const coldEmailBody = firstSent ? firstSent.body.slice(0, 1200) : null;
    return { messages, coldEmailBody };
  } catch {
    return empty;
  }
}

// ─── Reply CC fetch ──────────────────────────────────────────────────────────
// Reads the people CC'd on the inbound reply directly from EmailBison. Leads
// routinely loop in an agent, lawyer, or colleague via CC and say "talk to them" —
// their address lives in the CC header, never in the body, so the body-only
// detectAlternateSender misses it and the reply misroutes to the original sender
// (the Shawn/Andy incident, 2026-07-10). Surfacing the CC list to the drafter lets
// a referral handover route to the right person. Returns [] on any failure.
async function fetchReplyCc(
  instanceUrl: string,
  apiKey: string,
  ebReplyId: string | number | null
): Promise<Array<{ name: string | null; address: string }>> {
  if (!instanceUrl || !apiKey || !ebReplyId) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    let res: Response;
    try {
      res = await fetch(`${instanceUrl}/api/replies/${ebReplyId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return [];
    const data = await res.json();
    const cc = (data?.data?.cc ?? data?.cc ?? []) as Array<{ name?: string | null; address?: string }>;
    return cc
      .filter(c => c && typeof c.address === "string" && c.address.includes("@"))
      .map(c => ({ name: c.name ?? null, address: (c.address as string).toLowerCase() }));
  } catch {
    return [];
  }
}

/**
 * Returns EVERY participant address on the reply (from + to + cc), lowercased.
 * Used to suppress a contact who is involved in a thread in ANY position, not just
 * the CC — e.g. Peter emailing internally about an account shows up as the `from`,
 * not the CC (Zalina incident, 2026-07-14). Returns [] on any failure.
 */
async function fetchReplyAllAddresses(
  instanceUrl: string,
  apiKey: string,
  ebReplyId: string | number | null
): Promise<string[]> {
  if (!instanceUrl || !apiKey || !ebReplyId) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    let res: Response;
    try {
      res = await fetch(`${instanceUrl}/api/replies/${ebReplyId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return [];
    const data = await res.json();
    const item = data?.data ?? data ?? {};
    const out: string[] = [];
    if (typeof item.from_email_address === "string") out.push(item.from_email_address);
    for (const key of ["to_emails", "to", "cc"]) {
      for (const p of (item[key] ?? [])) {
        const a = p?.address ?? p?.email_address;
        if (typeof a === "string") out.push(a);
      }
    }
    return out.filter(a => a.includes("@")).map(a => a.toLowerCase());
  } catch {
    return [];
  }
}

// ─── Self-critique pass ────────────────────────────────────────────────────────

async function callClaudeCritique(
  leadMessage: string,
  draft: string,
  leadEnrichment: string,
  questionsToAnswer: string[],
  workspaceExtras?: string
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!checkRateLimit("claude-sonnet", 30)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);

  const hasBanList = !!workspaceExtras;
  const systemPrompt = `You are a reply quality reviewer. Read the lead's message and the drafted reply, then score it against ${hasBanList ? "five" : "four"} criteria.

CRITERIA:
1. answered_question: Did the reply directly address every specific question or request in the lead's message? If the lead asked something specific (a question, a request for info, a scheduling preference), it must be answered.
2. genuine_acknowledgment: ONLY applies if the lead's message contained a question or a concern (not a bare yes, agreement, or "sure let's chat"). If so, does the reply open by naming the SPECIFIC question or concern the lead raised, in a way that reads as genuine and could not be pasted onto any other reply? Superficial acknowledgments FAIL: "Great question", "Good question", "Thanks for flagging", "I completely understand", "I hear you", "Totally get it", "Fair point" used on its own, or any generic empathy line. If the lead's message had no question or concern (a plain yes/agreement), mark this true (not applicable).
3. has_personal_hook: Does the reply reference something concrete and specific to this lead or their company — from their message, their company name, their location, or the LEAD CONTEXT block? Generic replies that could go to anyone fail this. Only mark false if enrichment data was provided in the LEAD CONTEXT block and the reply ignores it entirely.
4. clean_opener: Does the reply avoid banned openers? Banned: "Great", "Sounds great", "Thanks for", "Hope this", "I'd love to", "Excited to", "I appreciate", any variation of these as the first word or first sentence. ALSO banned: opening with a formal self-introduction ("I'm [Name], Head of [Title]", "My name is...") or a formal firm description ("We work with a private investment group", "We are a...", "We help..."), even when the lead asked who you are or how you got their info. The reply must answer the lead's actual question first, casually, not lead with a bio or company pitch. Mark false if the opener introduces the sender or the firm before engaging what the lead said.${hasBanList ? `
5. no_banned_phrases: Does the reply avoid all phrases and constructions explicitly listed as banned in the WORKSPACE EXTRAS block in the user message? Check for exact matches and close paraphrases.` : ""}

VERDICT LOGIC:
- "rewrite" if answered_question is false
- "rewrite" if genuine_acknowledgment is false
- "rewrite" if has_personal_hook is false AND a LEAD CONTEXT block was provided with usable data
- "rewrite" if clean_opener is false${hasBanList ? `
- "rewrite" if no_banned_phrases is false` : ""}
- "approved" if all ${hasBanList ? "five" : "four"} pass

If verdict is "rewrite": fix only what failed. Do not change the substance, the Calendly link, the case studies, or the overall structure unless answered_question failed. Keep it tight. End with {SENDER_EMAIL_SIGNATURE}.
If verdict is "approved": reply_body must be an empty string.

OUTPUT — JSON only, no preamble, no fences:
{"answered_question":true,"genuine_acknowledgment":true,"has_personal_hook":true,"clean_opener":true${hasBanList ? `,"no_banned_phrases":true` : ""},"verdict":"approved","reply_body":""}`;

  const extrasBlock = workspaceExtras
    ? `\n\nWORKSPACE EXTRAS — BAN LIST ONLY (do not apply drafting instructions; only check whether banned phrases appear in the draft):\n${workspaceExtras}`
    : "";

  const userMessage = `LEAD'S MESSAGE:
${leadMessage.slice(0, 1000)}

${leadEnrichment ? `${leadEnrichment}\n\n` : ""}${questionsToAnswer.length > 0 ? `SPECIFIC QUESTIONS THAT MUST BE ANSWERED:\n${questionsToAnswer.map(q => `- ${q}`).join("\n")}\n\n` : ""}DRAFT REPLY TO REVIEW:
${draft}${extrasBlock}`;

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: ctrl.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") console.error("[auto-reply] Critique timed out");
    else console.error("[auto-reply] Critique error:", err?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) { console.error("[auto-reply] Critique API error:", response.status); return null; }

  const data = await response.json();
  const raw = (data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim();

  try {
    const c = JSON.parse(raw);
    if (c.verdict === "rewrite" && c.reply_body && c.reply_body.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim().length > 80) {
      console.log(`[auto-reply] Critique rewrote draft (answered:${c.answered_question} ack:${c.genuine_acknowledgment} hook:${c.has_personal_hook} opener:${c.clean_opener} banned:${c.no_banned_phrases ?? "n/a"})`);
      return c.reply_body as string;
    }
    return null;
  } catch {
    console.error("[auto-reply] Critique parse failed:", raw.slice(0, 200));
    return null;
  }
}

// ─── Pre-filters (zero Claude cost) ───────────────────────────────────────────

/** OOO, bounces, delivery failures, automated notices. */
function isNoActionReply(message: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    /out of office|on vacation|away from (the )?office|annual leave|maternity leave|parental leave/.test(m) ||
    /auto.?reply|automated (response|reply)|this is an automated/.test(m) ||
    /undeliverable|delivery has failed|delivery failure|bounce|mailer.daemon|postmaster/.test(m) ||
    /do not reply to this (email|message)|please do not reply/.test(m) ||
    /message could not be delivered/.test(m) ||
    /mailinblack|one click to deliver your email|confirm they are human|protected by protect/.test(m) ||
    // Dutch OOO patterns ("not in a position to reply", "back at the office on", "currently absent")
    /niet in de gelegenheid|terug op kantoor|momenteel afwezig|ben (ik )?afwezig|met vakantie/.test(m) ||
    // German OOO patterns ("currently on vacation", "outside the office")
    /derzeit (im )?urlaub|außerhalb des büros|abwesenheitsnotiz/.test(m) ||
    // French OOO patterns ("currently absent", "return to office")
    /actuellement absent(e)?|de retour le|réponse automatique/.test(m) ||
    // Spanish OOO patterns ("currently on vacation", "out of office")
    /actualmente de vacaciones|fuera de la oficina|respuesta automática/.test(m)
  );
}

/**
 * Conservative bulk-newsletter detector. Only matches mail carrying unambiguous
 * mass-send markers (List-Unsubscribe style footers, "view in browser", "manage
 * preferences", "Issue #N", explicit "Newsletter" subjects). Deliberately does
 * NOT match M&A deal-flow teasers ("Available for Acquisition", "Investment
 * Opportunity"): those can be real inbound deal flow for PE-buyer workspaces and
 * must stay in the queue.
 */
function isBulkNewsletter(subject: string, message: string): boolean {
  const s = (subject || "").toLowerCase();
  const m = (message || "").toLowerCase();
  const text = `${s}\n${m}`;
  return (
    /view (this )?(email|message|newsletter)?\s*(in|online in) (your )?(web ?)?browser/.test(text) ||
    /view (it |this )?online/.test(text) ||
    (/unsubscribe/.test(text) && /(manage|update|change|edit) (your )?(email |communication )?(preferences|subscription|settings)/.test(text)) ||
    /you('?re| are) receiving this (email|message)\s+because/.test(text) ||
    /to stop receiving (these )?(emails|messages|updates)/.test(text) ||
    /no longer wish to receive/.test(text) ||
    /\bissue\s*#\s*\d+/.test(s) ||
    /\bnewsletter\b/.test(s)
  );
}

/**
 * Per-workspace hard suppression rules. A reply matching one of these is silently
 * closed (status='read') before it can be forwarded, auto-sent, or routed to
 * #reply-approval / #manual-replies. Deterministic and zero Claude cost.
 *
 * Added 2026-07-03 on request:
 *   - Statera Capital: EmailBison "You got N new message(s)" notification stubs.
 *   - GN Motion: any reply mentioning Peter Gerasimov (in any field).
 *
 * Returns a skip-reason string when the reply should be suppressed, else null.
 */
function workspaceSuppressionReason(
  workspaceSlug: string,
  reply: Record<string, any>,
  messageText: string
): string | null {
  const subject = (reply.subject ?? "").toString();

  if (workspaceSlug === "statera-capital") {
    // "You got 1 new message", "You've got 2 new messages", "You have 1 new message", etc.
    if (/you(?:'ve| have)?\s*(?:got\s+)?\d+\s+new messages?/i.test(`${subject}\n${messageText}`)) {
      return "statera_new_message_notification";
    }
    // Piers Dunhill campaign (2026-07-09): the @dunhillventures.io persona inbox
    // (pd@, danielle@, jason@) is pure noise (LinkedIn, newsletters, spam). Suppress
    // every reply on that persona so none of it reaches reply-approval / manual-replies.
    const sender = (reply.sender_email ?? "").toString().toLowerCase();
    if (sender.endsWith("@dunhillventures.io") || /@dunhillventures\.io\b/.test(`${subject}\n${messageText}`.toLowerCase())) {
      return "statera_piers_dunhill";
    }
  }

  if (workspaceSlug === "gn-motion") {
    const raw = [reply.lead_name, reply.lead_email, reply.lead_company, subject, messageText]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    // Normalise separators so email/handle forms (peter.gerasimov@, peter_gerasimov,
    // petergerasimov) match the name too, not just the spaced "Peter Gerasimov".
    const normalized = raw.replace(/[^a-z0-9]+/g, " ");
    // Suppress anything Peter (peter@gnmotion.co) is engaged with — as sender, CC, or
    // mentioned anywhere in the thread — plus the original Peter Gerasimov name match.
    // Added peter@gnmotion.co 2026-07-09 on request: his threads were flooding the chats.
    if (normalized.includes("peter gerasimov") || raw.includes("petergerasimov") || raw.includes("peter@gnmotion.co")) {
      return "gn_motion_peter";
    }
  }

  return null;
}

/**
 * Scans the message for email addresses that differ from the lead on record.
 * Returns a warning string if a different sender is detected.
 */
function detectAlternateSender(message: string, leadEmail: string): string | null {
  if (!message || !leadEmail) return null;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const found = [...new Set((message.match(emailRegex) ?? []).map(e => e.toLowerCase()))];
  const leadNorm = leadEmail.toLowerCase();
  const others = found.filter(e =>
    e !== leadNorm &&
    !e.startsWith("noreply") && !e.startsWith("no-reply") &&
    !e.startsWith("donotreply") && !e.includes("mailer-daemon") &&
    !e.includes("postmaster")
  );
  if (others.length === 0) return null;
  // Only check the new reply body (before the quote trail). Emails that appear
  // only in the quoted section are from previous exchanges — flagging those would
  // produce false positives pointing to our own sender address or forwarded context.
  const bodyBeforeQuote = message.split(/\n[-]{3,}|\nOn .+ wrote:/)[0] ?? "";
  const inBody = others.filter(e => bodyBeforeQuote.toLowerCase().includes(e));
  if (inBody.length === 0) return null; // no alternate email in the new reply — skip
  return `RECIPIENT DETECTION: The reply contains email address(es) differing from the lead on record (${leadEmail}). Possible alternate sender(s): ${inBody.join(", ")}. Check whether to set recipient_email.`;
}

// ─── Claude API call (with prompt caching) ────────────────────────────────────

async function callClaude(systemPrompt: string, userMessage: string): Promise<AutoReplyResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // Safety valve: cap at 30 Sonnet calls per 60-second window across both processors.
  // Should never trigger under normal volume. If it does, a backlog spike or loop is burning tokens.
  if (!checkRateLimit("claude-sonnet", 30)) {
    console.warn("[auto-reply] Rate limit reached (30 calls/min) — skipping Claude call this cycle");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: CLAUDE_MAX_TOKENS,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") console.error("[auto-reply] Claude timed out after 90s");
    else console.error("[auto-reply] Claude fetch error:", err?.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    console.error("[auto-reply] Claude API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const raw = sanitizeJsonControlChars(
    (data.content?.[0]?.text ?? "").replace(/```json|```/g, "").trim()
  );

  // Tolerant parse
  try { return JSON.parse(raw) as AutoReplyResult; }
  catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as AutoReplyResult; }
      catch { /* fall through */ }
    }
    console.error("[auto-reply] Failed to parse Claude response:", raw.slice(0, 300));
    return null;
  }
}

// ─── EmailBison send ───────────────────────────────────────────────────────────

async function sendToEmailBison(reply: Record<string, any>, body: string, ccEmails?: string[]): Promise<boolean> {
  const { email_bison_instance_url: url, email_bison_api_key: key, email_bison_reply_id: ebId, sender_email_id: senderId } = reply;
  if (!url || !key || !ebId || !senderId) {
    console.error("[auto-reply] Missing EmailBison fields for reply", reply.id);
    return false;
  }

  const recipientEmail = reply.preferred_recipient_email ?? reply.lead_email;
  const recipientName = reply.preferred_recipient_name ?? reply.lead_name ?? null;

  const linkify = (t: string) => t
    .replace(/<((?:https?|mailto):[^|>\s]+)\|[^>]*>/g, "$1")
    .replace(/<((?:https?|mailto):[^|>\s]+)>/g, "$1")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  const htmlBody = body.split("\n\n")
    .map(p => `<p style="margin:0 0 16px 0;">${linkify(p.replace(/\n/g, "<br>"))}</p>`)
    .join("");

  const ccList = (ccEmails ?? [])
    .filter(e => typeof e === "string" && e.includes("@") && e.toLowerCase() !== recipientEmail.toLowerCase())
    .map(email_address => ({ name: null, email_address }));

  const payload: Record<string, unknown> = {
    message: htmlBody,
    sender_email_id: senderId,
    to_emails: [{ name: recipientName, email_address: recipientEmail }],
    inject_previous_email_body: true,
    content_type: "html",
  };
  if (ccList.length > 0) payload.cc_emails = ccList;

  const ebCtrl = new AbortController();
  const ebTimer = setTimeout(() => ebCtrl.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${url}/api/replies/${ebId}/reply`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      signal: ebCtrl.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") console.error("[auto-reply] EmailBison send timed out after 30s for reply", reply.id);
    else console.error("[auto-reply] EmailBison send error:", err?.message);
    return false;
  } finally {
    clearTimeout(ebTimer);
  }

  if (!res.ok) {
    console.error("[auto-reply] EmailBison error:", res.status, await res.text());
    return false;
  }
  return true;
}

// ─── Forward to client ─────────────────────────────────────────────────────────

async function forwardToClient(reply: Record<string, any>, forwardTo: string, ccEmails: string | null): Promise<boolean> {
  const { email_bison_instance_url: url, email_bison_api_key: key, email_bison_reply_id: ebId, sender_email_id: senderId } = reply;
  if (!url || !key || !ebId || !senderId) return false;

  const ebLink = `${url}/inbox/replies/${reply.id}`;
  const leadLine = [reply.lead_name, reply.lead_company].filter(Boolean).join(" at ") || reply.lead_email;
  const body = `FYI, new inbound reply from ${leadLine}.\n\nOpen in EmailBison to read the full thread and respond.\n\n${ebLink}`;
  const linkify = (t: string) => t
    .replace(/<((?:https?|mailto):[^|>\s]+)\|[^>]*>/g, "$1")
    .replace(/<((?:https?|mailto):[^|>\s]+)>/g, "$1")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  const htmlBody = body.split("\n\n").map(p => `<p style="margin:0 0 16px 0;">${linkify(p.replace(/\n/g, "<br>"))}</p>`).join("");

  const ccList = (ccEmails ?? "").split(",").map(e => e.trim()).filter(Boolean).map(email_address => ({ name: null, email_address }));
  const payload: Record<string, unknown> = {
    message: htmlBody, sender_email_id: senderId,
    to_emails: [{ name: null, email_address: forwardTo }],
    inject_previous_email_body: true, content_type: "html",
  };
  if (ccList.length > 0) payload.bcc_emails = ccList;

  const fwdCtrl = new AbortController();
  const fwdTimer = setTimeout(() => fwdCtrl.abort(), 30_000);
  try {
    const res = await fetch(`${url}/api/replies/${ebId}/reply`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      signal: fwdCtrl.signal,
    });
    return res.ok;
  } catch (err: any) {
    if (err?.name === "AbortError") console.error("[auto-reply] EmailBison forward timed out after 30s");
    else console.error("[auto-reply] EmailBison forward error:", err?.message);
    return false;
  } finally {
    clearTimeout(fwdTimer);
  }
}

// ─── Slack helpers ─────────────────────────────────────────────────────────────

// Workspaces that must NEVER surface a card in #manual-replies or #reply-approval.
// Hahnbeck is client-handled (forward-only): every reply is forwarded to their own
// inbox, so nothing about it should ever appear in our Slack channels (2026-07-12).
const SILENT_SLACK_WORKSPACES = new Set(["hahnbeck"]);

async function postManual(workspaceSlug: string, payload: { blocks: object[]; text: string }): Promise<void> {
  if (SILENT_SLACK_WORKSPACES.has(workspaceSlug)) return; // never post Hahnbeck to Slack
  // Per-workspace override routes manual-replies to the same channel as that workspace's
  // approval cards (e.g. Sonaro's #reply-management). NULL override → global #manual-replies.
  const overrideChannel = await approvalChannelFor(workspaceSlug);
  const channel = overrideChannel === REPLY_APPROVAL_CHANNEL ? MANUAL_REPLIES_CHANNEL : overrideChannel;
  await postToSlackShared({ channel, ...payload });
}

function buildCard(header: string, workspaceSlug: string, reply: Record<string, any>, instanceUrl: string, extra?: { reason?: string; intent?: string; sendingTo?: string }): object[] {
  const ebLink = reply.id && instanceUrl ? `${instanceUrl}/inbox/replies/${reply.id}` : null;
  const leadLine = [reply.lead_name, reply.lead_email].filter(Boolean).join(", ");
  const blocks: object[] = [
    { type: "header", text: { type: "plain_text", text: header, emoji: true } },
    { type: "section", fields: [
      { type: "mrkdwn", text: `*Client:*\n${slugToNameShared(workspaceSlug)}` },
      { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign ?? "unknown"}` },
    ]},
    { type: "section", text: { type: "mrkdwn", text: `*Lead:* ${extra?.sendingTo ?? leadLine}${extra?.intent ? `\n*Intent:* ${extra.intent}` : ""}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Subject:* ${reply.subject ?? "(no subject)"}` } },
  ];
  if (reply.message) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Lead's reply:*\n${quoteForSlack(reply.message, 600)}` } });
  }
  if (extra?.reason) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Reason:*\n${extra.reason}` } });
  if (ebLink) blocks.push({ type: "section", text: { type: "mrkdwn", text: `<${ebLink}|Open in EmailBison>` } });
  return blocks;
}

async function postApprovalCard(opts: {
  workspaceSlug: string; reply: Record<string, any>; instanceUrl: string; result: AutoReplyResult;
}): Promise<string | null> {
  const { workspaceSlug, reply, instanceUrl, result } = opts;
  const ebLink = reply.id && instanceUrl ? `${instanceUrl}/inbox/replies/${reply.id}` : null;
  const leadLine = [reply.lead_name, reply.lead_email].filter(Boolean).join(", ");

  // Prefer Claude's explicit override, fall back to the webhook-detected one.
  const effectiveRecipientEmail = result.recipient_email ?? reply.preferred_recipient_email ?? null;
  const effectiveRecipientName  = result.recipient_name  ?? reply.preferred_recipient_name  ?? null;
  const recipientOverride = effectiveRecipientEmail && effectiveRecipientEmail !== reply.lead_email;
  const sendingToLine = recipientOverride
    ? `:warning: *Sending to:* ${effectiveRecipientName ?? ""} <${effectiveRecipientEmail}> _(differs from lead: ${reply.lead_email})_`
    : `*Sending to:* ${leadLine}`;

  const ccLine = (result.cc_emails && result.cc_emails.length > 0)
    ? `\n*CC:* ${result.cc_emails.join(", ")} _(set by automation, verify before send)_`
    : "";

  const blocks: object[] = [
    { type: "header", text: { type: "plain_text", text: "Auto-reply draft, needs review", emoji: true } },
    { type: "section", fields: [
      { type: "mrkdwn", text: `*Client:*\n${slugToNameShared(workspaceSlug)}` },
      { type: "mrkdwn", text: `*Campaign:*\n${reply.campaign ?? "unknown"}` },
    ]},
    { type: "section", text: { type: "mrkdwn", text: `${sendingToLine}${ccLine}\n*Intent:* ${result.intent}  ·  *FU:* ${result.fu_sequence_type}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Subject:* ${reply.subject ?? "(no subject)"}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Lead's reply:*\n${quoteForSlack(reply.message ?? "", 600)}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Drafted reply:*\n${quoteForSlack(result.reply_body ?? "", 2500)}` } },
  ];
  if (result.manual_reason) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `:warning: *Note:* ${result.manual_reason}` } });
  }
  if (ebLink) blocks.push({ type: "section", text: { type: "mrkdwn", text: `<${ebLink}|Open in EmailBison>` } });
  blocks.push(approvalFooterBlock());

  return postToSlackShared({
    channel: await approvalChannelFor(workspaceSlug),
    text: `Auto-reply draft, ${workspaceSlug}, ${reply.lead_name}`,
    blocks,
  });
}

// ─── FU record ────────────────────────────────────────────────────────────────

async function createFuRecord(replyId: string, workspaceSlug: string, reply: Record<string, any>, fuType: "full" | "abbreviated" | "none", meetingBooked: boolean, unsubscribed: boolean): Promise<void> {
  if (fuType === "none" || meetingBooked || unsubscribed) return;
  const totalEmails = fuType === "abbreviated" ? 2 : 6;
  const fuId = `fu-${replyId}-${Date.now()}`;
  // FU sequence paused 2026-05-14. Row is still created for audit/re-enablement,
  // but next_fu_due is NULL so the processor cannot pick it up.
  await pool.query(
    `INSERT INTO follow_ups (id, reply_id, workspace_slug, lead_name, lead_email, first_replied_at, fu_step, total_emails, fu_sequence_type, meeting_booked, next_fu_due)
     SELECT $1,$2,$3,$4,$5,NOW(),0,$6,$7,FALSE,NULL
     WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE reply_id = $2)`,
    [fuId, replyId, workspaceSlug, reply.lead_name, reply.lead_email, totalEmails, fuType]
  );
}

// ─── Main processor ───────────────────────────────────────────────────────────

export async function processAutoReply(replyId: string, workspaceSlug: string): Promise<void> {
  if (process.env.AUTO_REPLY_PAUSED === "true") {
    console.log(`[auto-reply] PAUSED — skipping ${replyId}`);
    return;
  }
  try {
    await processAutoReplyImpl(replyId, workspaceSlug);
  } catch (err: any) {
    console.error(`[auto-reply] CRASH for ${replyId} (${workspaceSlug}):`, err);
    try { await pool.query(`UPDATE replies SET status = 'errored' WHERE id = $1`, [replyId]); } catch { /* ignore */ }
    try {
      const r = await pool.query(`SELECT r.lead_name, r.lead_email, r.subject, r.message, r.campaign, w.email_bison_instance_url FROM replies r LEFT JOIN workspaces w ON w.slug = r.workspace_slug WHERE r.id = $1`, [replyId]);
      const reply = r.rows[0] ?? {};
      await postManual(workspaceSlug, {
        text: `Auto-reply crashed, ${workspaceSlug} / ${reply.lead_name ?? replyId}`,
        blocks: buildCard("Auto-reply processor crashed", workspaceSlug, { id: replyId, ...reply }, reply.email_bison_instance_url ?? "", {
          reason: `${((err?.message ?? String(err)) || "unknown").slice(0, 400)}\n\nTo re-queue: UPDATE replies SET status='new' WHERE id='${replyId}'`,
        }),
      });
    } catch { /* ignore */ }
  }
}

async function processAutoReplyImpl(replyId: string, workspaceSlug: string): Promise<void> {
  // Skip workspaces that handle their own replies
  if (SKIP_WORKSPACES.has(workspaceSlug)) {
    await pool.query(`UPDATE replies SET status = 'read', auto_reply_processed_at = NOW() WHERE id = $1 AND status IN ('new','read')`, [replyId]);
    return;
  }

  // Atomic claim. Filter on status only — the dashboard's /api/analyze also writes
  // ai_analysis when a human opens a reply during the 2-min hold, so requiring
  // ai_analysis IS NULL would silently skip those rows and strand them at status='new'.
  const claim = await pool.query(`UPDATE replies SET status = 'processing', processing_started_at = NOW() WHERE id = $1 AND status IN ('new','read') RETURNING *`, [replyId]);
  if (claim.rows.length === 0) return;
  const reply = claim.rows[0];

  // 2-minute hold: gives time for a superseding reply from the same lead to arrive
  // before we burn Claude tokens drafting against a stale message. The /run endpoint
  // sleeps until this window passes before calling processAutoReply, so under normal
  // operation this check passes on the first try.
  const ageMs = Date.now() - new Date(reply.received_at).getTime();
  if (ageMs < 2 * 60 * 1000) {
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    return;
  }

  // Superseded check: if a newer reply from same lead is queued, skip this one.
  // Guard on non-empty lead_email — a null/empty email would match all empty-email replies.
  if (reply.lead_email) {
    const newer = await pool.query(
      `SELECT id FROM replies WHERE workspace_slug=$1 AND lead_email=$2 AND id!=$3 AND status='new' AND received_at>$4 LIMIT 1`,
      [workspaceSlug, reply.lead_email, replyId, reply.received_at]
    );
    if (newer.rows.length > 0) {
      await pool.query(`UPDATE replies SET status = 'read', auto_reply_processed_at = NOW() WHERE id = $1`, [replyId]);
      return;
    }
  }

  // Workspace + credentials
  const wsResult = await pool.query(
    `SELECT email_bison_api_key, email_bison_instance_url, auto_reply_approval_mode, forward_replies_to_email, forward_cc_emails FROM workspaces WHERE slug = $1`,
    [workspaceSlug]
  );
  if (wsResult.rows.length === 0) {
    console.error("[auto-reply] Workspace not found in DB:", workspaceSlug);
    await pool.query(`UPDATE replies SET status = 'errored', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ skipped_reason: "workspace_not_found", workspace_slug: workspaceSlug }), replyId]);
    return;
  }
  const workspace = wsResult.rows[0];
  const replyWithCreds = { ...reply, ...workspace };

  // ── Pre-filter 0: Empty message ──────────────────────────────────────────────
  const messageText = (reply.message ?? "").trim();
  if (!messageText) {
    await pool.query(`UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW(), auto_reply_processed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ intent: "no_action", skipped_reason: "empty_message" }), replyId]);
    return;
  }

  // ── Pre-filter 1: OOO / bounce / spam ────────────────────────────────────────
  // Run BEFORE forwarding so we don't forward bounces/OOO to clients.
  if (isNoActionReply(messageText)) {
    await pool.query(`UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW(), auto_reply_processed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ intent: "no_action", skipped_reason: "OOO/bounce/spam" }), replyId]);
    return;
  }

  // ── Pre-filter 1b: bulk newsletters ──────────────────────────────────────────
  // Conservative: only clear mass-send markers (see isBulkNewsletter). M&A
  // deal-flow teasers are intentionally left in the queue.
  if (isBulkNewsletter(reply.subject ?? "", messageText)) {
    await pool.query(`UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW(), auto_reply_processed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ intent: "no_action", skipped_reason: "bulk_newsletter" }), replyId]);
    return;
  }

  // ── Pre-filter 1c: Per-workspace hard suppression ────────────────────────────
  // Client-specific stubs/contacts that must never reach forwarding, reply-approval,
  // or manual-replies (Statera "N new messages" notifications; GN Motion Peter
  // Gerasimov). Runs before forwarding so these are never surfaced anywhere.
  {
    const suppressReason = workspaceSuppressionReason(workspaceSlug, reply, messageText);
    if (suppressReason) {
      await pool.query(`UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW(), auto_reply_processed_at = NOW() WHERE id = $2`,
        [JSON.stringify({ intent: "no_action", skipped_reason: suppressReason }), replyId]);
      return;
    }
  }

  // ── Pre-filter 1c-2: header-based suppression (Peter / Piers involved anywhere) ─
  // workspaceSuppressionReason only sees the body/fields, but the suppressed contact
  // often shows up ONLY in the email HEADERS (from/to/cc), never the body:
  //   - GN Motion: peter@gnmotion.co as CC (2026-07-12) or sender (Zalina, 2026-07-14).
  //   - Statera: the Piers Dunhill persona (@dunhillventures.io) CC'd on a Teams-invite
  //     thread where OUR sender_email is a different persona (Proximo, 2026-07-22).
  // Fetch all participant addresses (from + to + cc) and suppress if the contact is
  // anywhere among them. Only fires for the two affected workspaces.
  if (workspaceSlug === "gn-motion" || workspaceSlug === "statera-capital") {
    const addrs = await fetchReplyAllAddresses(workspace.email_bison_instance_url ?? "", workspace.email_bison_api_key ?? "", reply.email_bison_reply_id ?? null);
    const hit =
      (workspaceSlug === "gn-motion" && addrs.includes("peter@gnmotion.co")) ? "gn_motion_peter" :
      (workspaceSlug === "statera-capital" && addrs.some(a => a.endsWith("@dunhillventures.io"))) ? "statera_piers_dunhill" :
      null;
    if (hit) {
      await pool.query(`UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW(), auto_reply_processed_at = NOW() WHERE id = $2`,
        [JSON.stringify({ intent: "no_action", skipped_reason: hit }), replyId]);
      return;
    }
  }

  // ── Pre-filter 2: Own outbound email echoed back ──────────────────────────────
  // EmailBison occasionally fires a LEAD_REPLIED webhook whose body is our own
  // outbound cold email (the "From:" header matches our sender, not the lead).
  // Catching this here costs zero tokens — Claude is never called.
  // Important: only flag as echo if the "From: [our_sender]" appears near the top
  // of the message (index < 200). Replies that forward or quote our thread have our
  // sender email buried in the quoted section — those are genuine replies.
  if (reply.sender_email) {
    const senderEmailLower = (reply.sender_email as string).toLowerCase();
    const escaped = senderEmailLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const msgLower = messageText.toLowerCase();
    const match = new RegExp(`from:[^\\n]*${escaped}`).exec(msgLower);
    const textBeforeMatch = match ? msgLower.slice(0, match.index).trim() : "";
    if (match && match.index < 200 && textBeforeMatch.length < 10) {
      await pool.query(`UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW(), auto_reply_processed_at = NOW() WHERE id = $2`,
        [JSON.stringify({ intent: "no_action", skipped_reason: "own_outbound_echoed" }), replyId]);
      return;
    }
  }

  // ── Forwarding path ───────────────────────────────────────────────────────────
  const fileSlug = CLIENT_FILE_ALIASES[workspaceSlug] ?? workspaceSlug;
  const clientFileRaw = readFile(path.join(process.cwd(), "clients", `${fileSlug}.md`));
  if (!clientFileRaw) {
    console.error("[auto-reply] Client file not found:", workspaceSlug);
    await pool.query(`UPDATE replies SET status = 'new' WHERE id = $1`, [replyId]);
    return;
  }

  // Forward workspaces (e.g. Hahnbeck) used to have a regex positive-signal gate
  // here, which let marketing emails through (Chillhouse, 1st Phorm) when no positive
  // signal regex matched. The fix: run the same Claude classification as every other
  // workspace, then decide to forward based on Claude's intent. See the forward
  // branch after the "Hard gate" further down.

  const quickRef = extractQuickReference(clientFileRaw);

  // ── Build thread history from EmailBison directly ─────────────────────────────
  // Reads all messages (inbound + outbound) from EB so manual replies sent by
  // Kasper inside EmailBison are included. Falls back to "No prior messages."
  // if EB is unreachable — processor still drafts, just without thread context.
  const [ebThread, leadEnrichment, replyCc] = await Promise.all([
    fetchEBThread(
      workspace.email_bison_instance_url ?? "",
      workspace.email_bison_api_key ?? "",
      reply.lead_email,
      reply.email_bison_reply_id ?? null
    ),
    fetchLeadEnrichment(workspace.email_bison_instance_url ?? "", workspace.email_bison_api_key ?? "", reply.email_bison_lead_id ?? null),
    fetchReplyCc(workspace.email_bison_instance_url ?? "", workspace.email_bison_api_key ?? "", reply.email_bison_reply_id ?? null),
  ]);

  // People CC'd on this reply (agent, lawyer, colleague the lead may hand us to).
  // Exclude our own sender and the lead themselves so only genuine third parties remain.
  const ccThirdParties = replyCc.filter(c =>
    c.address !== (reply.lead_email ?? "").toLowerCase() &&
    c.address !== (reply.sender_email ?? "").toLowerCase() &&
    !c.address.startsWith("noreply") && !c.address.startsWith("no-reply")
  );
  const ccBlock = ccThirdParties.length > 0
    ? `PEOPLE CC'd ON THE LEAD'S REPLY (real addresses from the email header — the lead may be handing you to one of them):\n${ccThirdParties.map(c => `- ${c.name ?? "(no name)"} <${c.address}>`).join("\n")}\nIf the lead points you to one of these people ("I've cc'd my agent", "talk to [Name]", "looping in [Name]"), this is a REFERRAL HANDOVER: set recipient_email to that person's EXACT address from this list, address them by first name, and CC the original sender (${reply.lead_email}). Never address a person here without also setting recipient_email to their address — otherwise the reply goes to the wrong inbox.\n\n`
    : "";

  const threadHistory = ebThread.messages.length > 0
    ? ebThread.messages.map((m) => `[${m.dir === "inbound" ? "LEAD" : "US"}] ${new Date(m.sent_at).toISOString().slice(0, 16).replace("T", " ")}: ${m.body.slice(0, 1200)}`).join("\n\n")
    : "No prior messages.";

  const coldEmailBody = ebThread.coldEmailBody;

  // ── Thread interest anchor ────────────────────────────────────────────────────
  // Has this lead shown interest EARLIER in this thread (a prior interested flag,
  // a booked meeting, or a prior interested/needs_info classification)? If so, a
  // later message must be judged against that demonstrated interest, not in
  // isolation. A single negative answer to a qualifying question or a one-off
  // objection is the lead continuing to engage, not withdrawing, so it should
  // never be silently closed as not_interested.
  // "Prior interest" requires a REAL buying signal: a confirmed interested flag, a
  // booked meeting, or an earlier interested/interested_urgent classification. A single
  // past needs_info/neutral does NOT count — those are questions, not interest, and
  // treating them as interest is what caused ordinary "no thanks" replies to be held
  // open and dumped into #manual-replies instead of closing (fixed 2026-07-08).
  const priorInterest = await pool.query(
    `SELECT 1 FROM replies
     WHERE workspace_slug = $1 AND lead_email = $2 AND id <> $3
       AND ( interested = TRUE
          OR meeting_booked = TRUE
          OR ai_analysis->>'intent' IN ('interested','interested_urgent') )
     LIMIT 1`,
    [workspaceSlug, reply.lead_email, replyId]
  );
  const threadHasInterest = reply.lead_email ? priorInterest.rows.length > 0 : false;

  // ── Context injections ────────────────────────────────────────────────────────
  // If the webhook already identified a different sender (from_email_address != lead.email),
  // inject a hard directive so Claude addresses the right person and sets recipient_email.
  // This supersedes the body-text detectAlternateSender heuristic for these cases.
  const webhookSenderOverride = reply.preferred_recipient_email &&
    (reply.preferred_recipient_email as string).toLowerCase() !== reply.lead_email.toLowerCase();

  const alternateSender = webhookSenderOverride
    ? `RECIPIENT DETECTION: The reply was sent FROM ${reply.preferred_recipient_name ?? reply.preferred_recipient_email} <${reply.preferred_recipient_email}>, which differs from the campaign lead on record (${reply.lead_email}). You MUST address ${(reply.preferred_recipient_name as string | null)?.split(" ")[0] ?? "this person"} directly, NOT ${(reply.lead_name as string | null)?.split(" ")[0] ?? "the original lead"}. Set recipient_email to "${reply.preferred_recipient_email}" and recipient_name to "${reply.preferred_recipient_name ?? ""}".`
    : detectAlternateSender(messageText, reply.lead_email);

  // ── System prompt ─────────────────────────────────────────────────────────────
  const systemPrompt = `You are the reply agent for Maxen Partners, a cold email agency managing outbound campaigns for M&A advisors, PE firms, franchise brands, and creative agencies. Your job is to draft replies that read like they came from a senior person who carefully read the whole thread, not an AI working through a checklist.

## TONE (this comes before every other rule about what to say)

Write like a warm, considerate human replying to another human. The person on the other end is a real founder or operator who took the time to respond, treat them that way. Be kind, plain, and genuinely helpful. Sound like a thoughtful person, not a clever one.

Do NOT try to sound smart, impressive, or interesting. No clever openers, no MBA vocabulary, no showing off that you noticed something about their business. If a sentence exists to make US look sharp rather than to help THEM, cut it. A reply that is warm, clear, and short beats one that is clever every single time.

Read the ENTIRE thread before writing a single word. Everything already said, everything already offered, everything they already told you. Your reply must fit naturally as the next message in that specific conversation. If you would not understand your own reply reading the thread top to bottom, rewrite it.

Every reply is sent AS the client's sender (e.g. Jeff Zanardi from ACT Capital, Nicklas Larsen from Larsen Digital, Svetlin Petrov from Statera Capital). You are not Maxen Partners. You are that person. Write in first person as them. Never refer to the sender by name as a subject ("Nicklas works with" is wrong. "I work with" is right. Always).

## BEFORE YOU WRITE ANYTHING — DO THESE FOUR THINGS

1. READ THE REPLY QUICK REFERENCE. It tells you the campaign type, Calendly link, teasers, and rules for this exact client. Every client is different. The REPLY QUICK REFERENCE overrides everything below.

2. READ THE THREAD HISTORY AND ORIGINAL EMAIL, TOP TO BOTTOM. Know what was already said and what was offered. This is non-negotiable: before you write, list to yourself what has already been sent (links, stats, case studies, value props, questions we already asked). NEVER repeat any of it. If a stat, link, case study, or value prop already appears anywhere in the thread, it is off limits, reference it as "as I mentioned" at most, never restate it. If the teaser or case study was already sent, do not send it again, acknowledge it and move the conversation forward. Repeating something the lead already read is the clearest sign a reply was written by a bot that did not read the thread.

3. READ WHAT THE LEAD ACTUALLY WROTE. Respond to their message, not the category of their message. If they asked a specific question, answer it. If they gave a time window, do not pretend they did not.

4. CHECK THE RECIPIENT. If the reply was sent by someone other than the lead on record (different name, "forwarded to me by", reply from a different email address), set recipient_email and recipient_name to that person. Address them directly.

5. USE THE LEAD COMPANY CONTEXT BLOCK WHERE IT GENUINELY HELPS. The block gives you EXIT SIGNALS, the attributes that make this brand attractive to a strategic or PE buyer (own manufacturing, consumable LTV, patented IP, premium pricing, category buyer interest, etc.). Reference ONE concrete detail from it when it makes the reply more relevant to what the lead actually asked, and weave it in naturally. Do NOT force a clever observation about their business into the opener of every reply just to prove you did your homework. If the lead asked a plain question or said a plain yes, a plain, warm, direct answer serves them better than a personalized hook. Never lead with a hook that reads as "look what I noticed about you."

CRITICAL FRAMING. The reason we reach out to a brand is because something about THEIR brand makes us think they could exit well. NEVER frame it as "we focus on [category] brands" or "we work with [category]". We do NOT focus on categories, we focus on brands that look exit-worthy. The right framing is "what made [BRAND] stand out" or "what stood out about [BRAND]" followed by the specific exit signal. The signal can be one of:
   - their product is consumable / generates repeat purchase / strong LTV
   - they have proprietary IP, a patent, or a defensible formula
   - premium positioning suggests strong margins
   - their category is seeing real buyer interest right now (only say this if genuinely true)
   - they own manufacturing or have meaningful vertical integration
   - distinctive brand identity that holds up at exit

If no LEAD COMPANY CONTEXT block appears (because the site was unreachable), fall back to LEAD CONTEXT (location, size, LinkedIn) and reference one of those instead.

DISTINGUISHING REPLY INTENTS, this changes how you draft:
- "Why are you interested in MY company?" / "What made you reach out to me?" → answer the why directly. Lead with what about THEIR brand makes them interesting for an exit (a specific EXIT SIGNAL). Brief mention of what we do. Then slot. Pattern E2.
- "Send me more info" / "Tell me more" / "Share details about how you work" → they want to learn about us, so explain briefly what we do (we help founders maximize the value of their brand at exit), and tie it to ONE specific exit signal we noticed about their brand. Then slot. Pattern E3.
Both intents reference EXIT SIGNALS. The difference is which side leads (their brand vs. what we do).

## CAMPAIGN TYPE RULES (REPLY QUICK REFERENCE overrides these)

Sell-side advisory (approaching business owners about selling): goal is a call. No teaser. Send Calendly only. Never name the buyer.

Mandate / buy-side (approaching investors or buyers with a deal): send the correct teaser, then pull to a call. Match the teaser to the campaign name and trigger keywords in the REPLY QUICK REFERENCE. If two mandates exist, pick the one whose keywords match the campaign name. If unclear, default to a call.

Agency / services (franchise, CGI, growth): goal is a call. Answer what they asked — case studies, pricing, how it works — then redirect to a call.

## HOW TO DRAFT

HARD LENGTH CAP. Every reply body (everything between "Hi [name]" and "{SENDER_EMAIL_SIGNATURE}") MUST be 150 words or fewer. Count them before you finalize. The cap exists because long templated pitches read as automation and get ignored, but the cap is high enough to fit a full personalized opener + clean value paragraph + value-rich CTA + slot proposal.

Structure budget: greeting line, then 3 to 5 short paragraphs, then the slot or Calendly line. Each paragraph should add genuine value for the reader, not pad the reply.

Mirror their length and energy. A one-line "Sure" gets a short, warm response, not a pitch. A specific question ("why are you interested in my company") justifies a fuller reply that answers it properly and honestly. When a fuller reply is warranted: answer what they asked first, say plainly what we do, then a simple no-pressure invitation to a call. Keep the language everyday. Do not dress the call up as "mapping EV multiples / operational levers / deal structures", just offer a genuine conversation about their options.

Start with the substance, and make the first body line acknowledge what the lead actually said. Do not default to a stock opener regardless of context. Examples:
- Lead asked for more info ("send me details", "tell me more", "share more info"): "Happy to share more." fits.
- Lead agreed with a point ("yes you're probably right", "good point", "fair point"): acknowledge the agreement. "Glad that resonated." or "Appreciate that." Do NOT open with "Happy to share more." because they did not ask for info.
- Lead said yes to a meeting ("happy to chat", "let's set something up", "sure send the link", "sure, send the calendar link"): skip the info dump and acknowledge the meeting ask. "Easiest is to grab a slot here, ..." or "Great, let's get a time on the calendar."
- CRITICAL — Lead said yes to a permission-ask CTA ("Mind if I share more details?", "Mind if I send some more info?", "Would it be ok to share how we work?"): the lead agreed to RECEIVE INFORMATION, not to book a call. Do NOT skip straight to a calendar link. Use E2 — send the info (what we do + their specific exit signal) with the Calendly as a soft option at the end. This is NOT the same as "yes to a meeting".
- Lead is forwarding to a colleague ("@John have a chat with them"): greet the new person first, briefly acknowledge the intro from the original sender.
- Lead pushed back, hedged, or raised an objection: acknowledge the specific point they made before pivoting.

Never write a first line that could be sent to any lead. It must respond to THIS lead's specific message.

Then jump to the substance, no "Thanks for getting back to me" filler.

Make it specific. Reference something concrete: the specific fact from LEAD COMPANY CONTEXT HOOK, their actual message, their company, their question, their hesitation. Generic replies that could go to anyone are wrong. If you find yourself writing a sentence that could apply to any DTC brand, replace it with a sentence that could only apply to THIS brand.

CATEGORY filling: when the template has [CATEGORY], pull the value from LEAD COMPANY CONTEXT CATEGORY line. If that line says "skincare brands", write "skincare brands". Do not output the placeholder [CATEGORY] or the generic phrase "your category" in the final reply.

The goal is a 30-minute call. Every reply should move toward it. When you send the Calendly link, make the ask feel natural.

If they already said yes to a call: do not re-pitch. Do not ask "Worth a quick call?" again. They said yes. Send the link and stop.

If they said no: stop. No reply at all. Not even an acknowledgment unless they asked to be removed from the list.

CLASSIFYING A DECLINE (read carefully, this controls whether we bother a human). If the lead declines, passes, says it is not relevant, not a fit, not the right time in a final way, or otherwise shows no interest AND asks no genuine question, classify it as not_interested. Do NOT soften a clear no into neutral or needs_info to keep the conversation alive, that just drafts a reply to someone who said no or dumps it on a human. Only use needs_info when the lead genuinely asks something or challenges a premise and a reply is actually warranted. Only use neutral when the message is truly unclear. The single exception: if this same lead already showed real interest earlier in this thread (see ESTABLISHED INTEREST block if present), treat a later objection as continued engagement per that block.

## THE TRIPLE A FRAMEWORK (use whenever the lead asks a question or raises a concern)

When the lead's message contains a real question or a concern (anything beyond a bare "sure, let's chat" or "yes send the link"), the reply MUST do three things, in this order:

1. ACKNOWLEDGE what they actually said. Not a generic opener. Restate the specific question or concern in your own words so it is obvious you read it and understood it. It has to read like a person who genuinely engaged with their point. BANNED as acknowledgments (they are superficial filler): "Great question", "Good question", "Thanks for flagging", "I completely understand", "I hear you", "Totally get it", or "Fair point" used on its own, or any line that could be pasted onto any reply. A genuine acknowledgment names the actual thing they raised (their pricing worry, their wholesale-vs-D2C point, their timing, the exact detail they asked about). If you cannot name the specific thing, you have not read closely enough. Acknowledge the QUESTION or CONCERN only, never the tangential market commentary they add alongside it.

2. ANSWER their question directly and honestly. Give the real answer, do not dodge straight to the call. If you genuinely do not have the specific (exact pricing, a number, a legal specific), give the honest high-level answer and say the precise detail is easiest to cover live. NEVER invent a fact, number, or specific to fill the answer. A truthful "here is the shape of it, the exact figure depends on X and is quickest to walk through on a call" beats a confident wrong answer every time.

3. ASK for the next step (the call), earned by the answer you just gave, not bolted on. Calibrate the ask:
   - Normal question or concern: a clear, warm ask with the Calendly line.
   - Permission-ask CTA (E2) or an early "what do you actually do": keep the ask SOFT, Calendly as an option at the end, do not hard-push.
   - They already booked, or proposed a specific time: do NOT ask again. Acknowledge and answer, then confirm. (Specific human-stated times still route to manual per the Calendly rules below.)
   - They deferred ("let me review", "circle back later", "not right now"): acknowledge and answer, then leave the door open ("whenever you are ready, happy to find a time") instead of pushing a slot.

Triple A is a CONTENT checklist, not a three-paragraph template. Weave it naturally, stay under the 150-word cap, and never output literal "Acknowledge / Answer / Ask" labels. Acknowledge and answer can share a sentence. Do not pad.

## CALENDLY AND AVAILABILITY

Never confirm specific times. Never say "Thursday works" or "I have availability." Always use the Calendly link from the REPLY QUICK REFERENCE with a natural line: "Feel free to grab a time here: [link]"

${CALENDLY_SLOT_PROMPT_RULE}

Exception: if the REPLY QUICK REFERENCE says always_send_calendly:true (Larsen Digital), always send Calendly even when the lead gives a specific day or time.

Route to manual ONLY when: (1) lead explicitly says "call me" or "give me a call" AND provides a phone number they want to be called on — a phone number in their email signature alone does not count; (2) lead gives a specific day AND time AND always_send_calendly is not true.

Route to manual when a lead asks for a meeting in a specific human-stated timeframe ("next week", "this week", "Monday morning", "Tuesday afternoon", "later this month"). These are edge cases where a human should pick the slot and confirm directly, rather than the auto reply proposing slots. Calendly slots can still be sent for general interest ("happy to chat", "sure send the link"), but specific human-stated windows go to manual.

CRITICAL — DO NOT INVENT REASONS TO ESCALATE: If a lead says "yes", "sure", "please send it over", "send me the teaser", "I'm interested", or any clear affirmative — draft the reply and set action to auto_send. Do not route to manual because you imagine a scenario (NDA, data room, legal process) that is not explicitly stated in the lead's message. Only escalate to manual for the three cases above (phone with number, specific day+time without always_send_calendly, specific human-stated meeting window). Everything else: draft it and send it.

REFERRAL HANDOVER PATTERN: When the lead forwards/passes you to a colleague ("@Gilbert have an initial conversation", "looping in our COO", "let's bring in [Name]"), do all of this:
1. Set recipient_email and recipient_name to the new person they pointed you to (the colleague, not the original lead). Their exact address is almost always in the "PEOPLE CC'd ON THE LEAD'S REPLY" block in the user message — use it verbatim. NEVER greet a person without setting recipient_email to their address; addressing "Andy" while leaving recipient_email unset sends the reply to the wrong inbox.
2. Greet the new person by first name.
3. Briefly acknowledge the intro from the original sender in one short line.
4. Keep the reply SHORT. The colleague has been pre-greenlit, do not dump info, do not pitch the full value prop, do not list case studies.
5. Lead with the Calendly link or proposed slots. The whole reply is at most 4 short lines plus signature.
6. If LIVE CALENDAR AVAILABILITY is present, propose the two slots. Otherwise just send the Calendly link with a natural lead-in.
7. ALWAYS CC THE INTRODUCER. Set cc_emails to an array containing the original sender's email (the person who made the intro). This is non-negotiable, standard etiquette, the introducer needs to see we followed up so they know the loop closed. Do not skip this even if it feels optional.

## WHAT NEVER TO DO

- Never use em dashes or en dashes. Restructure the sentence instead.
- Never use colons in body copy. The only colon allowed is the one before a URL link.
- Never open with: "Hope this finds you well", "Thanks for reaching out", "I appreciate you taking the time", "Sounds great!", "I'd love to", "Excited to"
- Never open with a formal self-introduction ("I'm [Name], Head of [Title]", "My name is...") or a formal "we work with a private investment group" / "we are a..." / "we help..." company statement, EVEN when the lead asks who you are or how you got their information. Nobody replies to an email by introducing themselves like a pitch. Answer their actual question directly and casually, in the natural flow of what they said, and let {SENDER_EMAIL_SIGNATURE} handle the identity. Lead with the answer to their question, never with a bio or a description of the firm.
- Never confirm times or fabricate availability
- Never reply to a not-interested or hard-no lead
- Never send a teaser that does not match the campaign, default to a call if unsure
- Never refer to the sender in third person as the subject of a sentence
- Never end with "Best," or any name, the signature variable handles everything
- Never pad a short yes-reply into multiple paragraphs
- Never repeat a stat, link, or angle already in the thread
- Never list multiple case studies or revenue trajectories inline (e.g. "Brand A went from X to Y, Brand B did Z"). Single brief reference at most. Save the case study dump for the call.
- Never recite our M&A track record stats unprompted ("$1B+ in CPG transactions", "closed X deals"). BUT it is OK and encouraged to mention "M&A bankers as co-advisors" as the mechanism for how we get founders the best exit, just without the specific stat dump. Phrase as a credibility hook, not a stats dump.
- Never explain our pricing model unless explicitly asked
- Never list 3-phase models or operational breakdowns in the body. If the lead asked for info, give one plain sentence about what we do (we help founders maximize the value of their brand at exit), then tie it to their brand's exit signal, then go to slot.
- Never jump straight to Calendly when the original cold email asked permission to share info ("Mind if I share more details?", "Want to see the deck?", "Mind if I send some more info?") and the lead said yes. They said yes to information, not a call. Route this as E2: send what we do + their specific exit signal, then Calendly as a soft option. A reply that is only "Glad to hear it. Here's my calendar." is WRONG for this case.
- Never engage with or acknowledge market commentary a lead adds alongside a request ("the industry is tough", "we've seen volume drops"). Fulfill the request and stop. Do not rebut or validate their observations.

BANNED WORDS / PHRASES (zero tolerance, do not appear in any reply body):
- "differentiated" / "differentiated angle" / "differentiation" (just describe the specific thing)
- "positioning" as a noun ("your positioning"). Either describe what they actually say about themselves, or use "the way you describe yourselves"
- "package" in the M&A sense ("package the numbers")
- "the kind of X that buyers pay extra for" (any sentence in this shape is MBA-deck language)
- "velocity" (say "speed" or "pace")
- "verticals" (say "industries" or "categories")
- "leverage" as a verb (say "use")
- "synergies"
- "go to market" as a phrase (just describe what's happening)
- "run rate", "top-line", "bottom-line" (use "revenue", "profit")
- "we focus on [category] brands" / "we work with [category] brands" / "brands in your category". We DO NOT focus on categories. We focus on brands that look exit-worthy. Reframe these sentences around the brand's specific exit signals.

If a sentence you wrote uses any of these, rewrite it in words a 16-year-old would use. Write like a smart founder texting another founder, not like a McKinsey deck.

## REPLY STRUCTURE

Hi [First Name],

[Blank line]

[Substance — start here, no preamble]

[Blank line between every paragraph]

{SENDER_EMAIL_SIGNATURE}

## EXAMPLES (what good looks like, pattern-match against these before writing)

--- E2: CANONICAL LARSEN DIGITAL TEMPLATE for "why are you interested in MY company" / "tell me more" / "send more info" / "share details about how you work" ---
THIS TEMPLATE IS FIXED TEXT WITH PLACEHOLDER FILL. Treat it as a fill-in-the-blanks task, NOT a creative rewrite.

Rules:
- Output the template VERBATIM, only substituting [PLACEHOLDERS].
- Do NOT reword any non-placeholder text. "at the moment" stays "at the moment", do not change to "right now". "branded trademark" stays "branded trademark", do not change to "registered trademark" or "branded IP". "to get you the best exit possible" stays in para 2.
- Do NOT merge paragraphs. Output 5 distinct paragraphs after the greeting. The CTA paragraph and the no-pressure paragraph are SEPARATE.
- Do NOT skip a paragraph.
- The ONLY allowed substitutions are: [FIRST_NAME], [BRAND], [SPECIFIC EXIT SIGNAL], [SPECIFIC ATTRIBUTE], [SLOT 1 NATURAL], [SLOT 2 NATURAL], [CALENDLY_LINK].

Hi [FIRST_NAME],

What caught my eye about [BRAND] was [SPECIFIC EXIT SIGNAL from LEAD COMPANY CONTEXT, e.g. "the branded trademark in the sports recovery space" or "a patented non-steroid formula in a consumable, repeat-purchase category"]. Buyer interest is increasing in the consumer space at the moment, and a brand [SPECIFIC ATTRIBUTE drawn from EXIT SIGNALS, e.g. "positioning itself as a category innovator with its own registered IP", "with defensible IP and recurring purchase built in", "with vertical integration and premium pricing power"] tends to command higher valuations at exit.

We help founders build the parts of the business that increase enterprise value most, while pulling in M&A bankers as co-advisors when taking brands to market to get you the best exit possible.

If this aligns with your goals for [BRAND], let's grab 15 minutes to discuss valuation/exit and growth opportunities.

Whether exiting is on the immediate horizon or not, you would leave with a clearer read on your valuation and exit options.

Would [SLOT 1 NATURAL] or [SLOT 2 NATURAL] work? If not, grab a slot on my calendar here: [CALENDLY_LINK]

{SENDER_EMAIL_SIGNATURE}

PLACEHOLDER FILLING RULES (do this automatically, never leave placeholders as literal strings in the output):
- [FIRST_NAME] = lead's first name from their signature or the lead_name field
- [BRAND] = the actual brand name (not the {COMPANY} merge variable), grab from lead_company, signature, or LEAD COMPANY CONTEXT
- [SPECIFIC EXIT SIGNAL] = ONE exit-worthy attribute pulled directly from LEAD COMPANY CONTEXT EXIT SIGNALS (patented IP, consumable LTV, premium margins, own manufacturing, category buyer interest, etc.). Phrase it naturally, not as a label.
- [SPECIFIC ATTRIBUTE] = a slightly different angle on the same EXIT SIGNAL or a related attribute, written to flow with "a brand [SPECIFIC ATTRIBUTE] tends to command..."
- [SLOT 1 NATURAL] / [SLOT 2 NATURAL] = the two natural-language strings from LIVE CALENDAR AVAILABILITY exactly as given (e.g. "Monday at 1pm BST")
- [CALENDLY_LINK] = the Calendly URL from REPLY QUICK REFERENCE (for Larsen Digital, https://calendly.com/larsen-digital-marketing/intro)

If LIVE CALENDAR AVAILABILITY has fewer than 2 slots (e.g. lead is in a TZ that doesn't overlap with Nicklas's business hours), drop the "Would [SLOT 1] or [SLOT 2] work?" sentence and just write "Easiest is to grab a slot on my calendar here: [CALENDLY_LINK]"

--- E3: "Copying my CEO" (forward to decision-maker) ---
Right: Address both by first name. Two sentences on what you do. Calendly.

Hi Fabian and Hewad,

Appreciate the introduction.

We work with DTC brands on growth with a clear exit strategy built in from day one. We only work with 15 brands at a time to keep the focus sharp.

Easiest to lock something in here so we can walk through what that looks like for your brand: [CALENDLY_LINK]

{SENDER_EMAIL_SIGNATURE}

--- E4: "Send the teaser" with market commentary attached ---
Lead: "Send over the Teaser. [long paragraph about category headwinds and competitor struggles]"
Wrong: Acknowledge their analysis, argue your deal is positioned differently, then send teaser.
Right: Send the teaser. Do not engage with their market commentary at all.

Hi Stewart,

Teaser link below, the NDA is accessible directly through it:
[TEASER_LINK]

Happy to walk through the details on a call. Feel free to grab a time here: [CALENDLY_LINK]

{SENDER_EMAIL_SIGNATURE}

## OUTPUT — JSON ONLY. NO PREAMBLE. NO FENCES.

Fill in questions_to_answer, personal_hook, and pivot_line BEFORE writing reply_body. These commit you to substance before you start writing.

{
  "questions_to_answer": ["every specific question the lead asked. empty array if none."],
  "personal_hook": "one concrete fact you are using from their message, company, or context. empty string only if genuinely nothing is available.",
  "pivot_line": "the exact sentence used to lead into the Calendly link. empty string if no Calendly in this reply.",
  "action": "auto_send" | "manual" | "do_nothing",
  "intent": "interested" (ANY positive engagement: a clear yes, OR wanting more info / materials / the teaser, OR asking substantive questions about the deal, valuation, structure, or process because they are weighing it, e.g. "send more info" / "tell me more") | "needs_info" (the lead needs a reply but has NOT shown interest: corrects a premise in the cold email, questions who you are or how you got their info, or asks a skeptical / gatekeeping question) | "neutral" (vague, no clear signal) | "not_interested" | "unsubscribe" | "hard_no" (definitive disqualification) | "wrong_target" | "hostile",
  "fu_sequence_type": "full" (interested/needs_info/neutral) | "abbreviated" (soft timing objection: "not right now", "not the right time") | "none" (booked/unsubscribe/hard_no/wrong_target/hostile),
  "reply_body": "full plain text reply. Required when action is auto_send.",
  "manual_reason": "one sentence. Required when action is manual.",
  "flag_unsubscribe": false,
  "flag_meeting_booked": false,
  "recipient_email": "only if reply was written by someone other than the lead on record",
  "recipient_name": "display name if recipient_email is set",
  "cc_emails": ["array of email addresses to CC. Use for referral handovers to keep the original sender in the loop. Empty array if no CCs needed."]
}`;

  const coldEmailBlock = coldEmailBody
    ? `ORIGINAL COLD EMAIL SENT TO THIS LEAD (what they are responding to):\n${coldEmailBody}\n\n`
    : "";

  // ── Lead company research (fetch + Haiku-summarize website) ──────────────────
  // Every interested/needs_info reply gets a custom hook based on what the lead's
  // company actually does. Cached 7 days per domain in lead_website_cache.
  // Silent fallback if unreachable, processor still drafts with template-only
  // personalization but the human-level hook line will be missing.
  let companyContextBlock = "";
  const leadDomain = resolveLeadDomain({ leadEmail: reply.lead_email });
  if (leadDomain) {
    const ctx = await getLeadCompanyContext(leadDomain);
    if (ctx) {
      companyContextBlock = `LEAD COMPANY CONTEXT (read this carefully, you MUST reference at least one specific concrete fact from here in the opener or hook line of the reply, no generic praise):
Source: ${leadDomain} (${ctx.source})
${ctx.summary}

`;
    }
  }

  // ── Live Calendly slot suggestion ─────────────────────────────────────────────
  // For clients with a per-client Calendly config (lib/calendly.ts), infer the
  // lead's timezone from enrichment/email/company, then pull 2 well-spaced live
  // slots in that TZ. Slots are injected into the prompt so Claude can propose
  // them as natural "would either of these work?" options. Calendly link remains
  // the fallback. Silently no-ops if Calendly is unreachable or token missing.
  let calendlyHint = "";
  const categoryOverride = lookupCategoryForDomain(reply.lead_email);
  if (categoryOverride) {
    calendlyHint += `CATEGORY OVERRIDE for this lead, use exactly "${categoryOverride}" wherever the template asks for [CATEGORY]. Do not infer a different category.\n\n`;
  }
  if (CALENDLY_CLIENT_CONFIG[workspaceSlug]) {
    const clientCfg = CALENDLY_CLIENT_CONFIG[workspaceSlug];
    const inferred = inferLeadTimezone({
      enrichment: leadEnrichment,
      leadEmail: reply.lead_email,
      leadCompany: reply.lead_company,
      defaultTz: clientCfg.defaultTz,
      defaultUsTz: "America/New_York",
    });
    const slots = await suggestSlotsForClient(workspaceSlug, inferred.tz);
    const liveBlock = buildLiveCalendarBlock(slots);
    if (liveBlock) {
      calendlyHint = `${liveBlock}
Lead's inferred timezone: ${inferred.tz} (${inferred.reason})
Do not confirm a single slot, always offer both.

`;
    }
  }

  // Recent approved sends as in-context positive examples. Updates the
  // processor's "what good looks like" every time it drafts. Silent fallback
  // if the query returns nothing (e.g. fresh workspace with no sends yet).
  const positiveExamples = await fetchRecentApprovedExamples(workspaceSlug, reply.lead_email, 3);

  const threadInterestDirective = threadHasInterest
    ? `ESTABLISHED INTEREST IN THIS THREAD: This lead already showed interest earlier in this conversation (see THREAD HISTORY). Judge this new message in the context of that demonstrated interest, NOT in isolation. A negative answer to a qualifying question, a single objection, a raised concern, or "the rest is not a fit" is the lead CONTINUING to qualify and engage, so classify it as needs_info or neutral and draft a reply that addresses the concern and keeps the conversation moving. Only use not_interested or hard_no if THIS message is an explicit, unambiguous withdrawal of interest (e.g. "stop contacting me", "remove me", "we've decided not to proceed", "definitely not interested"). When in doubt in an interested thread, draft a reply rather than closing.\n\n`
    : "";

  const userMessage = `REPLY QUICK REFERENCE:
${quickRef}

${companyContextBlock}${calendlyHint}${positiveExamples}${threadInterestDirective}${ccBlock}${alternateSender ? `${alternateSender}\n\n` : ""}${leadEnrichment ? `${leadEnrichment}\n\n` : ""}${coldEmailBlock}THREAD HISTORY — WHAT HAS BEEN SAID (oldest first, do not repeat anything already here):
${threadHistory}

INBOUND REPLY TO RESPOND TO:
From: ${reply.lead_name} <${reply.lead_email}>
Company: ${reply.lead_company ?? "unknown"} | Title: ${reply.lead_title ?? "unknown"}
Campaign: ${reply.campaign ?? "unknown"}
Subject: ${reply.subject ?? ""}

${messageText.slice(0, 8000)}`;

  // ── Append per-workspace learnings to the system prompt ──────────────────────
  // Loaded from prompts/extras/<slug>.md so the weekly-review handler can
  // auto-commit approved feedback patterns without touching the core prompt.
  // Cache invalidation cost is per-workspace, not global.
  const workspaceExtras = readWorkspaceExtras(workspaceSlug);
  const effectiveSystemPrompt = workspaceExtras
    ? `${systemPrompt}\n\n## WORKSPACE-SPECIFIC LEARNINGS (${workspaceSlug})\n\n${workspaceExtras}`
    : systemPrompt;

  // ── Call Claude ───────────────────────────────────────────────────────────────
  let result = await callClaude(effectiveSystemPrompt, userMessage);

  // Second pass: if interested and we have the quoted chain, re-draft with full context.
  // This only fires for ~10-20% of replies so the extra credit cost stays minimal.
  // The first pass already classified intent; the second pass improves the draft quality
  // by letting Claude see what was originally promised/asked in the cold email.
  if (
    result &&
    (result.intent === "interested" || result.intent === "needs_info") &&
    reply.thread_context
  ) {
    const threadContextBlock = `PRIOR EMAIL CHAIN (quoted in lead's reply — what they are responding to):\n${(reply.thread_context as string).slice(0, 4000)}\n\n`;
    const enrichedMessage = userMessage.replace(
      "THREAD HISTORY — WHAT HAS BEEN SAID",
      `${threadContextBlock}THREAD HISTORY — WHAT HAS BEEN SAID`
    );
    const refined = await callClaude(effectiveSystemPrompt, enrichedMessage);
    if (refined) result = refined;
  }

  if (!result) {
    // Track consecutive Claude failures. After 3 failures, mark errored instead of
    // resetting to 'new' — prevents infinite retry loops when the API key is out of
    // credits or the model is down for an extended period.
    const prevAnalysis = reply.ai_analysis as Record<string, any> ?? {};
    const failCount = (prevAnalysis.claude_fail_count ?? 0) + 1;

    if (failCount >= 3) {
      await pool.query(`UPDATE replies SET status = 'errored', ai_analysis = $1, ai_analyzed_at = NOW() WHERE id = $2`,
        [JSON.stringify({ ...prevAnalysis, claude_fail_count: failCount, skipped_reason: "claude_repeated_failure" }), replyId]);
      console.error(`[auto-reply] Claude failed 3x for ${workspaceSlug} / ${reply.lead_name} — marked errored`);
    } else {
      await pool.query(`UPDATE replies SET status = 'new', ai_analysis = $1 WHERE id = $2`,
        [JSON.stringify({ ...prevAnalysis, claude_fail_count: failCount }), replyId]);
      console.warn(`[auto-reply] Claude returned null for ${replyId} (fail ${failCount}/3) — will retry`);
    }
    return;
  }

  // Sanitize
  if (result.reply_body) result.reply_body = sanitizeDashes(result.reply_body);
  if (result.manual_reason) result.manual_reason = sanitizeDashes(result.manual_reason);

  // Any not_interested / hard_no closes silently, ALWAYS. Per explicit instruction
  // (2026-07-09): a lead who says no or "not interested" must never be routed to
  // #manual-replies, even if they showed interest earlier in the thread. Just close
  // it and move on. The old "surface soft-no in an interested thread to a human"
  // safety net was removed because it was filling #manual-replies with declines.
  // Falls through to the hard gate below, which sets status='read' with no Slack post.

  // Hard gate: not_interested and hard_no are NEVER replied to, regardless of Claude's action.
  // The pre-filter catches most of these for free; this catches any that slip through to Claude.
  if (result.intent === "not_interested" || result.intent === "hard_no") {
    await pool.query(`UPDATE follow_ups SET next_fu_due = NULL, outcome = 'closed' WHERE reply_id = $1`, [replyId]);
    await pool.query(`UPDATE replies SET status = 'read', interested = FALSE, ai_analysis = $1, ai_analyzed_at = NOW(), auto_reply_processed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ intent: result.intent, auto_replied: false, skipped_reason: "not_interested_no_reply" }), replyId]);
    return;
  }

  // ── Back-sync interested classification to EmailBison ─────────────────────────
  // Bumps EmailBison's interested count for this reply so /api/workspaces/v1.1/stats
  // (the source the CSM update reads) matches what we see in our own DB. Fires only
  // for genuine buying interest (interested/interested_urgent), regardless of which
  // route handles it next (forward, auto_send, manual, do_nothing). Idempotent —
  // no-ops if already interested or missing EmailBison metadata. Errors are logged,
  // never thrown.
  //
  // needs_info is intentionally EXCLUDED: those replies still get drafted and run
  // through #reply-approval, but "needs info" means the lead asked a question, not
  // that they showed interest. We do not flip our `interested` flag or EmailBison's
  // interested count for them.
  //
  // Special case: if EmailBison refuses because no contact is attached (off-campaign
  // inbound, deleted lead, etc.), post to #manual-replies so a teammate can attach
  // the lead in EmailBison or mark interested manually in EmailBison's UI.
  // Forward workspaces (Hahnbeck) skip back-sync entirely: the client handles the
  // reply from their own inbox, so we never need to mark-interested for the CSM count,
  // and we must never surface the "EmailBison refused" alert to #manual-replies for
  // them. The reply flows straight to the forward branch below (2026-07-12).
  if (["interested", "interested_urgent"].includes(result.intent) && !workspace.forward_replies_to_email) {
    try {
      const bs = await backsyncInterestedToEmailBison(replyId);
      if (bs.skipped && bs.skipped !== "already_interested") {
        console.log(`[auto-reply] back-sync skipped for ${replyId}: ${bs.skipped}`);
        if (bs.skipped.startsWith("emailbison_refused:")) {
          const reason = bs.skipped.replace(/^emailbison_refused:\s*/, "");
          await postManual(workspaceSlug, {
            text: `EmailBison refused mark-as-interested, ${workspaceSlug} / ${reply.lead_name}`,
            blocks: buildCard(
              "EmailBison can't mark this reply as interested",
              workspaceSlug,
              replyWithCreds,
              workspace.email_bison_instance_url ?? "",
              {
                intent: result.intent,
                reason:
                  `${reason}\n\n` +
                  `Our DB has this reply marked as ${result.intent}, but EmailBison ` +
                  `won't accept the mark because there's no contact attached to the ` +
                  `reply (off-campaign inbound, deleted lead, or wrong sender). ` +
                  `Two options:\n` +
                  `  1. Attach the lead in EmailBison's UI, then mark as interested there.\n` +
                  `  2. Mark as interested directly in EmailBison's reply view.\n` +
                  `Until this is fixed, the reply won't count in /api/workspaces/v1.1/stats ` +
                  `and so won't show up in the CSM update.`,
              }
            ),
          });
          await pool.query(
            `UPDATE replies SET status='awaiting_manual', ai_analysis=$1, ai_analyzed_at=NOW(), auto_reply_processed_at=NOW() WHERE id=$2`,
            [JSON.stringify({ intent: result.intent, auto_replied: false, skipped_reason: "emailbison_refused_mark_interested" }), replyId]
          );
          return;
        }
      }
    } catch (err: any) {
      console.error(`[auto-reply] back-sync failed for ${replyId}:`, err?.message);
    }
  }

  // ── Forward-workspace branch ────────────────────────────────────────────────
  // Forwarding workspaces (e.g. Hahnbeck) don't auto-reply — the client handles
  // replies from their own inbox. We only forward when Claude classifies the
  // reply as clearly worth the client's time: `interested` or `needs_info`.
  // Everything else (neutral, unsubscribe, wrong_target, hostile) is closed silently.
  if (workspace.forward_replies_to_email) {
    const forwardableIntents = new Set(["interested", "needs_info"]);
    if (!forwardableIntents.has(result.intent)) {
      await pool.query(`UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW(), auto_reply_processed_at = NOW() WHERE id = $2`,
        [JSON.stringify({ intent: result.intent, skipped_reason: "forward_workspace_intent_not_forwardable" }), replyId]);
      return;
    }
    const forwarded = await forwardToClient(replyWithCreds, workspace.forward_replies_to_email, workspace.forward_cc_emails ?? null);
    if (forwarded) {
      await pool.query(`INSERT INTO sent_emails (id,reply_id,workspace_slug,lead_email,lead_name,email_type,subject,body,sent_at) VALUES ($1,$2,$3,$4,$5,'forward_to_client',$6,$7,NOW())`,
        [`fwd-${replyId}-${Date.now()}`, replyId, workspaceSlug, reply.lead_email, reply.lead_name, reply.subject ?? "", `[Forwarded to ${workspace.forward_replies_to_email}]`]);
    } else {
      console.error(`[auto-reply] Forward failed for ${workspaceSlug} / ${reply.lead_name} → ${workspace.forward_replies_to_email}`);
    }
    await pool.query(`UPDATE replies SET status = $1, ai_analysis = $2, ai_analyzed_at = NOW(), auto_reply_processed_at = $3 WHERE id = $4`,
      [
        forwarded ? "forwarded" : "new",
        JSON.stringify({ intent: result.intent, forwarded_to: workspace.forward_replies_to_email, status: forwarded ? "sent" : "failed" }),
        forwarded ? new Date() : null,
        replyId,
      ]);
    return;
  }

  // Enforce fu_sequence_type = none for hard-close intents
  if (["unsubscribe", "wrong_target", "hostile"].includes(result.intent)) {
    result.fu_sequence_type = "none";
  }

  // Enforce fu_sequence_type = full for interested/needs_info. Claude occasionally
  // returns "none" here which is a schema violation — only hard closes get none.
  if (["interested", "needs_info"].includes(result.intent) && result.fu_sequence_type === "none") {
    result.fu_sequence_type = "full";
  }

  // If Claude returns manual for a hard-close intent, just close silently instead.
  if (result.action === "manual" && new Set(["unsubscribe","wrong_target","hostile","not_interested","hard_no"]).has(result.intent)) {
    result.action = "do_nothing";
  }

  // Body length guard: catch genuinely truncated replies while letting valid short
  // confirmations through (e.g. a lead who already booked a meeting just needs "Perfect,
  // looking forward to it!"). Length alone is a poor signal — the real tell of truncation
  // is an incomplete ending (mid-sentence, or a trailing comma like "Hi John,"). A reply
  // that ends with terminal punctuation or an emoji is a complete thought, so we allow it.
  // 80-char floor / 2026-05-11 batch incident context retained for fragments.
  if (result.action === "auto_send" && result.reply_body) {
    const stripped = result.reply_body.replace(/\{SENDER_EMAIL_SIGNATURE\}/gi, "").trim();
    // Strip a trailing emoji/symbol so we can read the punctuation underneath it.
    const lastChar = stripped.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s"')\]]+$/u, "").slice(-1);
    const endsComplete = /[.!?]/.test(lastChar) || /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(stripped.slice(-2));
    // A short reply is only truncation if it looks incomplete. Complete short confirmations pass.
    if (stripped.length < 80 && (!endsComplete || stripped.length < 15)) {
      result.action = "manual";
      result.manual_reason = `Generated reply too short (${stripped.length} chars) and ends incompletely — likely truncation. Needs manual review.`;
    }
  }

  // Self-critique pass: for interested/needs_info auto-sends, run a second Claude call
  // that checks the draft against three criteria and rewrites only if something fails.
  if (
    result.action === "auto_send" &&
    result.reply_body &&
    (result.intent === "interested" || result.intent === "needs_info")
  ) {
    const revised = await callClaudeCritique(
      messageText,
      result.reply_body,
      leadEnrichment,
      result.questions_to_answer ?? [],
      workspaceExtras || undefined
    );
    if (revised) result.reply_body = sanitizeDashes(revised);
  }

  // Signature guard: strip any hand-written sign-off and guarantee exactly one
  // {SENDER_EMAIL_SIGNATURE} at the end, so EmailBison's resolved signature never
  // doubles up with a manual sign-off the model may have added.
  if (result.reply_body) {
    result.reply_body = normalizeSignature(result.reply_body);
  }

  // DB flags
  if (result.flag_unsubscribe) {
    await pool.query(`UPDATE replies SET interested = FALSE WHERE id = $1`, [replyId]);
    await pool.query(`UPDATE follow_ups SET next_fu_due = NULL, outcome = 'unsubscribed' WHERE reply_id = $1`, [replyId]);
  }
  if (result.flag_meeting_booked) {
    await pool.query(`UPDATE replies SET meeting_booked = TRUE WHERE id = $1`, [replyId]);
    await pool.query(`UPDATE follow_ups SET meeting_booked = TRUE, next_fu_due = NULL, outcome = 'booked' WHERE reply_id = $1`, [replyId]);
  }

  // Referral-CC backstop: if the draft greets a CC'd third party by first name but
  // recipient_email was NOT set to their address, set it here (and CC the original
  // lead). Guarantees a "Hi Andy" reply reaches Andy even if the model addressed him
  // without setting the recipient — the exact Shawn/Andy misroute. Deterministic.
  if (ccThirdParties.length > 0 && result.reply_body) {
    const greetMatch = result.reply_body.match(/^\s*(?:hi|hello|hey|dear)\s+([a-z][a-z'\-]+)/i);
    const greetedFirst = greetMatch?.[1]?.toLowerCase();
    const recipLower = (result.recipient_email ?? "").toLowerCase();
    const recipIsCc = ccThirdParties.some(c => c.address === recipLower);
    if (greetedFirst && !recipIsCc) {
      const match = ccThirdParties.find(c => (c.name ?? "").toLowerCase().split(/\s+/)[0] === greetedFirst);
      if (match) {
        result.recipient_email = match.address;
        result.recipient_name = match.name ?? result.recipient_name;
        const leadLower = (reply.lead_email ?? "").toLowerCase();
        if (leadLower && !(result.cc_emails ?? []).map(e => e.toLowerCase()).includes(leadLower)) {
          result.cc_emails = [...(result.cc_emails ?? []), reply.lead_email];
        }
        console.log(`[auto-reply] Referral-CC backstop: routed to CC'd ${match.address} (greeted "${greetedFirst}"), CC lead ${reply.lead_email}`);
      }
    }
  }

  // Persist recipient override BEFORE routing — approval path reads it from DB later.
  // Previously this was inside the auto_send branch, so approved drafts sent to wrong address.
  if (result.recipient_email) {
    await pool.query(`UPDATE replies SET preferred_recipient_email=$1, preferred_recipient_name=$2 WHERE id=$3`,
      [result.recipient_email, result.recipient_name ?? null, replyId]);
    replyWithCreds.preferred_recipient_email = result.recipient_email;
    replyWithCreds.preferred_recipient_name = result.recipient_name ?? null;
  }

  // ── Deactivated case study backstop ──────────────────────────────────────────
  // Last line of defence: if a drafted body still references a banned case study
  // (stale client-file line, recycled example, or model hallucination slipped
  // through the prompt), never send it. Route to a human with the offending name
  // named so they can swap in an approved reference. See BANNED_CASE_STUDIES.
  if (result.reply_body) {
    const banned = containsBannedCaseStudy(result.reply_body);
    if (banned) {
      result.action = "manual";
      result.manual_reason = `Draft referenced a deactivated case study ("${banned}"). Blocked from sending. Rewrite with an approved reference before sending.`;
      console.warn(`[auto-reply] Blocked banned case study "${banned}" in draft for ${replyId} (${workspaceSlug} / ${reply.lead_name})`);
    }
  }

  // ── Dealgen Partners backstop ────────────────────────────────────────────────
  // Dealgen Partners campaigns must never get an auto-reply with a call/calendar
  // (2026-07-10 instruction: "we do not want them on a call"). Force any reply-worthy
  // Dealgen draft to #manual-replies for a human. Hard-close intents already closed
  // silently above, so this only catches interested/needs_info/neutral auto-sends.
  if (/dealgen/i.test((reply.campaign ?? "").toString()) && result.action === "auto_send") {
    result.action = "manual";
    result.manual_reason = result.manual_reason ?? "Dealgen Partners campaign: no call or calendar link. Human handles this lead directly.";
    console.log(`[auto-reply] Dealgen campaign — routed to manual (no call/calendar) for ${replyId} (${reply.campaign})`);
  }

  // ── Route ─────────────────────────────────────────────────────────────────────

  if (result.action === "auto_send" && result.reply_body) {
    const alwaysAutoSend = new Set(["unsubscribe","hard_no","wrong_target","hostile","not_interested"]);

    // Every interested reply goes to #reply-approval for human review before sending.
    // Hard closes (unsubscribe, not_interested, etc.) auto-send/close without review.
    if (!alwaysAutoSend.has(result.intent)) {
      const draftId = `rd-${replyId}-${Date.now()}`;
      const slackTs = await postApprovalCard({ workspaceSlug, reply: replyWithCreds, instanceUrl: workspace.email_bison_instance_url ?? "", result });

      if (!slackTs) {
        // Approval card post failed. Do NOT fall through to a direct send — that
        // would auto-send a review-required reply with no human in the loop. That
        // exact fall-through caused ~17h of unreviewed interested-reply sends during
        // the 2026-06-16 Slack outage. Fail safe instead: retry via the sweeper a few
        // times (handles a transient Slack blip), then park the draft in #manual-replies
        // so a human sends it. The draft is never sent unreviewed.
        const prev = (reply.ai_analysis as Record<string, any>) ?? {};
        const slackFails = (prev.slack_fail_count ?? 0) + 1;
        if (slackFails >= 3) {
          await pool.query(
            `INSERT INTO reply_drafts (id,reply_id,workspace_slug,lead_name,lead_email,intent,action,fu_sequence_type,flag_unsubscribe,flag_meeting_booked,manual_reason,subject,body,status,slack_ts,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',NULL,NOW())`,
            [draftId, replyId, workspaceSlug, reply.lead_name, reply.lead_email, result.intent, result.action, result.fu_sequence_type, result.flag_unsubscribe, result.flag_meeting_booked, result.manual_reason ?? null, reply.subject ?? "", result.reply_body]
          );
          await pool.query(`UPDATE replies SET status='awaiting_manual', ai_analysis=$1, ai_analyzed_at=NOW(), auto_reply_processed_at=NOW() WHERE id=$2`,
            [JSON.stringify({ ...prev, intent: result.intent, slack_fail_count: slackFails, skipped_reason: "approval_card_post_failed" }), replyId]);
          // Best-effort manual alert with the drafted body inline. If the same outage
          // also kills this post, the reply still sits at awaiting_manual in the dashboard.
          const manualBlocks = buildCard("Approval card couldn't post — send this manually", workspaceSlug, replyWithCreds, workspace.email_bison_instance_url ?? "", {
            intent: result.intent,
            reason: `Drafted reply could not be posted to ${REPLY_APPROVAL_CHANNEL} after 3 tries (Slack returned no ts — likely a token/channel/config issue in the deployed env). Send manually, or fix Slack and re-queue with: UPDATE replies SET status='new', ai_analysis = ai_analysis - 'slack_fail_count' WHERE id='${replyId}'`,
          });
          manualBlocks.push({ type: "section", text: { type: "mrkdwn", text: `*Drafted reply:*\n${quoteForSlack(result.reply_body ?? "", 2500)}` } });
          await postManual(workspaceSlug, {
            text: `Approval card post failed 3x, ${workspaceSlug} / ${reply.lead_name} — needs manual send`,
            blocks: manualBlocks,
          }).catch(() => { /* manual channel may share the outage; row is already at awaiting_manual */ });
          console.error(`[auto-reply] Approval card post failed 3x for ${replyId} — routed to manual, NOT auto-sent`);
        } else {
          await pool.query(`UPDATE replies SET status='new', ai_analysis=$1 WHERE id=$2`,
            [JSON.stringify({ ...prev, slack_fail_count: slackFails }), replyId]);
          console.warn(`[auto-reply] Approval card post failed for ${replyId} (fail ${slackFails}/3) — will retry`);
        }
        return;
      }

      await pool.query(
        `INSERT INTO reply_drafts (id,reply_id,workspace_slug,lead_name,lead_email,intent,action,fu_sequence_type,flag_unsubscribe,flag_meeting_booked,manual_reason,subject,body,status,slack_ts,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,NOW())`,
        [draftId, replyId, workspaceSlug, reply.lead_name, reply.lead_email, result.intent, result.action, result.fu_sequence_type, result.flag_unsubscribe, result.flag_meeting_booked, result.manual_reason ?? null, reply.subject ?? "", result.reply_body, slackTs]
      );
      await pool.query(`UPDATE replies SET status='awaiting_approval', ai_analysis=$1, ai_analyzed_at=NOW(), auto_reply_processed_at=NOW() WHERE id=$2`,
        [JSON.stringify({ intent: result.intent, auto_replied: false, awaiting_approval: true, fu_sequence_type: result.fu_sequence_type }), replyId]);
      return;
    }

    // Direct send (only for hard closes — unsubscribe confirmations etc.)
    const sent = await sendToEmailBison(replyWithCreds, result.reply_body, result.cc_emails);
    if (sent) {
      await pool.query(`INSERT INTO sent_emails (id,reply_id,workspace_slug,lead_email,lead_name,email_type,subject,body,sent_at) VALUES ($1,$2,$3,$4,$5,'auto_reply',$6,$7,NOW())`,
        [`auto-${replyId}-${Date.now()}`, replyId, workspaceSlug, reply.lead_email, reply.lead_name, reply.subject ?? "", result.reply_body]);
      const interested = ["interested","interested_urgent"].includes(result.intent);
      await pool.query(`UPDATE replies SET status='replied', interested=$1, ai_analysis=$2, ai_analyzed_at=NOW(), auto_reply_processed_at=NOW() WHERE id=$3`,
        [interested ? true : null, JSON.stringify({ intent: result.intent, auto_replied: true, fu_sequence_type: result.fu_sequence_type }), replyId]);
      await createFuRecord(replyId, workspaceSlug, reply, result.fu_sequence_type, result.flag_meeting_booked, result.flag_unsubscribe);
      console.log(`[auto-reply] Sent ${replyId} (${workspaceSlug} / ${reply.lead_name})`);
    } else {
      const prevAnalysis2 = reply.ai_analysis as Record<string, any> ?? {};
      const ebFails = (prevAnalysis2.eb_fail_count ?? 0) + 1;
      if (ebFails >= 3) {
        await pool.query(`UPDATE replies SET status = 'errored', ai_analysis = $1 WHERE id = $2`,
          [JSON.stringify({ ...prevAnalysis2, eb_fail_count: ebFails }), replyId]);
        console.error(`[auto-reply] EmailBison send failed 3x for ${workspaceSlug} / ${reply.lead_name} — marked errored`);
      } else {
        await pool.query(`UPDATE replies SET status = 'new', ai_analysis = $1 WHERE id = $2`,
          [JSON.stringify({ ...prevAnalysis2, eb_fail_count: ebFails }), replyId]);
        console.warn(`[auto-reply] EmailBison send failed for ${replyId} (fail ${ebFails}/3) — will retry`);
      }
    }

  } else if (result.action === "manual") {
    await pool.query(`UPDATE replies SET status = 'awaiting_manual', auto_reply_processed_at = NOW() WHERE id = $1`, [replyId]);
    await postManual(workspaceSlug, { text: `Manual handling needed, ${workspaceSlug} / ${reply.lead_name}`,
      blocks: buildCard("Manual handling needed", workspaceSlug, replyWithCreds, workspace.email_bison_instance_url ?? "", { reason: result.manual_reason ?? "Needs human attention.", intent: result.intent }) });
    await createFuRecord(replyId, workspaceSlug, reply, result.fu_sequence_type, result.flag_meeting_booked, result.flag_unsubscribe);

  } else {
    // do_nothing path
    await pool.query(`UPDATE replies SET status = 'read', ai_analysis = $1, ai_analyzed_at = NOW(), auto_reply_processed_at = NOW() WHERE id = $2`,
      [JSON.stringify({ intent: result.intent, action: "do_nothing", auto_replied: false }), replyId]);
    if (result.intent === "unsubscribe") {
      await pool.query(`UPDATE follow_ups SET next_fu_due = NULL, outcome = 'unsubscribed' WHERE reply_id = $1`, [replyId]);
    }

    // If it looks like an interested reply but the automation couldn't figure out what to do,
    // send to #manual-replies so a human can handle it.
    const hardCloses = new Set(["not_interested", "hard_no", "unsubscribe", "wrong_target", "hostile"]);
    if (!hardCloses.has(result.intent)) {
      await postManual(workspaceSlug, {
        text: `Interested reply needs human review, ${workspaceSlug} / ${reply.lead_name}`,
        blocks: buildCard("Couldn't draft a reply — needs human", workspaceSlug, replyWithCreds, workspace.email_bison_instance_url ?? "", {
          reason: result.manual_reason ?? "Automation returned do_nothing for an interested-looking reply.",
          intent: result.intent,
        }),
      });
    }
  }
}

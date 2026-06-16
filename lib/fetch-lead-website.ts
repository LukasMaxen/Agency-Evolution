import pool from "@/lib/db";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const SUMMARY_TIMEOUT_MS = 20_000;
const MAX_HTML_CHARS = 60_000;

export type LeadCompanyContext = {
  domain: string;
  summary: string;
  fetched_at: string;
  source: "cache" | "fresh" | "fallback";
};

/**
 * Resolve the most reliable website URL for a lead. Order of preference:
 *   1. Explicit website field from EmailBison enrichment (passed as enrichmentWebsite).
 *   2. Email domain (e.g. jim@qilta.com → qilta.com).
 * Returns null if neither is usable.
 */
export function resolveLeadDomain(opts: { enrichmentWebsite?: string | null; leadEmail?: string | null }): string | null {
  if (opts.enrichmentWebsite) {
    try {
      const url = new URL(opts.enrichmentWebsite.startsWith("http") ? opts.enrichmentWebsite : `https://${opts.enrichmentWebsite}`);
      return url.hostname.replace(/^www\./, "");
    } catch { /* fall through */ }
  }
  if (opts.leadEmail) {
    const m = opts.leadEmail.toLowerCase().match(/@([^>\s]+)$/);
    if (m) {
      const domain = m[1];
      // Skip personal email providers, they tell us nothing about the company.
      const personal = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "msn.com", "aol.com", "proton.me", "protonmail.com"]);
      if (!personal.has(domain)) return domain;
    }
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractMeta(html: string, names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    // og:* and twitter:* use property=, name=description uses name=
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i"),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) { out.push(decodeEntities(m[1]).trim()); break; }
    }
  }
  return out;
}

function extractTagText(html: string, tag: string, max: number): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const inner = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (inner.length > 2 && inner.length < 300) out.push(decodeEntities(inner));
  }
  return out;
}

/**
 * Builds a clean text block from a page's HTML. Prioritizes meta tags and headings
 * because they describe the brand directly, rather than dumping raw body content
 * which on modern (Shopify/Next.js/etc) sites is often polluted with inline CSS,
 * JSON-LD blobs, and component framework noise.
 */
function stripHtmlToText(html: string): string {
  // 1. Strip scripts, styles, JSON-LD, comments
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // 2. Pull high-signal pieces first
  const title = (cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const meta = extractMeta(cleaned, [
    "og:title", "og:description", "og:site_name", "og:type",
    "twitter:title", "twitter:description",
    "description", "keywords", "author",
  ]);
  const h1 = extractTagText(cleaned, "h1", 5);
  const h2 = extractTagText(cleaned, "h2", 8);
  const h3 = extractTagText(cleaned, "h3", 8);
  const paragraphs = extractTagText(cleaned, "p", 20);
  const listItems = extractTagText(cleaned, "li", 25);

  // 3. Strip remaining tags and any CSS-looking blobs that survived in raw text
  let body = cleaned
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^{}]{0,500}\}/g, " ")           // remove leftover CSS rule bodies
    .replace(/:[a-zA-Z-]+\s*\(\s*[^)]*\)/g, " ") // remove leftover var(), rgb(), etc.
    .replace(/--[a-zA-Z0-9-]+\s*:/g, " ")        // remove leftover CSS variable declarations
    .replace(/\s+/g, " ")
    .trim();
  body = decodeEntities(body);

  const parts = [
    title ? `TITLE: ${title}` : "",
    meta.length > 0 ? `META: ${meta.join(" | ")}` : "",
    h1.length > 0 ? `H1: ${h1.join(" | ")}` : "",
    h2.length > 0 ? `H2: ${h2.join(" | ")}` : "",
    h3.length > 0 ? `H3: ${h3.join(" | ")}` : "",
    paragraphs.length > 0 ? `PARAGRAPHS: ${paragraphs.join(" | ")}` : "",
    listItems.length > 0 ? `BULLETS: ${listItems.join(" | ")}` : "",
    body ? `BODY: ${body.slice(0, 8000)}` : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}

async function fetchRawSite(domain: string): Promise<string | null> {
  const url = `https://${domain}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      console.warn(`[fetch-lead-website] ${domain} returned ${res.status}`);
      return null;
    }
    const text = await res.text();
    return text.slice(0, MAX_HTML_CHARS);
  } catch (err: any) {
    if (err?.name === "AbortError") console.warn(`[fetch-lead-website] ${domain} timed out`);
    else console.warn(`[fetch-lead-website] ${domain} error:`, err?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function summarizeWithHaiku(domain: string, plainText: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SUMMARY_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system: `You read a brand's website for a sales rep at an M&A growth firm. The firm helps DTC founders maximize the value of their brand when they exit. Your job is to extract the attributes that make THIS brand attractive to a strategic or PE buyer, so the rep can reference them in outreach. Output plain text, no markdown, no preamble, no bullet characters.

Always produce a summary using whatever signal exists. Even thin sites have a title, meta description, or og:description. Do not refuse, do not say "I cannot determine", do not output disclaimers. The TITLE and META lines in the input are the highest-signal sources, use them first. Treat raw BODY text cautiously, it often contains CSS framework noise from Shopify/Next.js themes.

Output exactly these lines, in this order, each prefixed with the label and a single space, no other formatting:

WHAT THEY SELL: one short sentence on the product or service.
CATEGORY: 2-4 words, plural (e.g. "skincare brands", "supplements", "personal care", "athletic apparel", "sports recovery"). Be specific to what they actually sell.
EXIT SIGNALS: 2-4 short comma-separated phrases identifying attributes that make THIS brand interesting to a buyer at exit. Examples of what to look for and infer from the site:
  - "consumable product, repeat purchase" if it's a cream, supplement, food, beverage, etc. (recurring LTV is a buyer magnet)
  - "patented formula" or "proprietary IP" if defensibility is mentioned (creates a moat)
  - "premium pricing" or "clinical positioning" if they sell high-trust, high-margin products
  - "own manufacturing" or "vertical integration" if visible
  - "founder-led with growth signals" if there's a founder story plus revenue traction hints
  - "category attracting buyer interest" only if you genuinely know that segment is hot (sports recovery, prebiotics, science-backed skincare, etc.)
  - "strong brand identity" if there's a distinctive aesthetic or tagline
  - "subscription model" if visible
  Be honest. Don't fabricate signals that aren't on the site.
HOOK: ONE concrete sentence the rep can drop into a reply to prove they actually read the site. Should be specific and reference an actual visible detail (product name, tagline, claim, unique angle). Avoid generic praise.

Remember, you are extracting EXIT SIGNALS, not category positioning. The rep does not reach out to brands because they're in a category. The rep reaches out because the brand looks like it could exit well. Frame your output that way.`,
        messages: [{ role: "user", content: `Domain: ${domain}\n\nWebsite content (plain text extracted from HTML):\n\n${plainText.slice(0, 18_000)}` }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[fetch-lead-website] Haiku error for ${domain}:`, res.status);
      return null;
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? "").trim();
    if (!text || text.length < 40) return null;
    return text;
  } catch (err: any) {
    if (err?.name === "AbortError") console.warn(`[fetch-lead-website] Haiku timed out for ${domain}`);
    else console.warn(`[fetch-lead-website] Haiku fetch error for ${domain}:`, err?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns a brief, structured summary of the lead's company website. Cached for 7 days
 * per domain in lead_website_cache. Used by the auto-reply processor to personalize
 * the opener, hook line, and category in every reply.
 *
 * Silently returns null on any failure so the caller can fall back to template-only
 * personalization without breaking the draft.
 */
export async function getLeadCompanyContext(domain: string): Promise<LeadCompanyContext | null> {
  if (!domain) return null;
  // Cache check
  try {
    const cached = await pool.query<{ summary: string; fetched_at: Date }>(
      `SELECT summary, fetched_at FROM lead_website_cache WHERE domain = $1 LIMIT 1`,
      [domain]
    );
    if (cached.rows.length > 0) {
      const age = Date.now() - new Date(cached.rows[0].fetched_at).getTime();
      if (age < CACHE_TTL_MS && cached.rows[0].summary) {
        return {
          domain,
          summary: cached.rows[0].summary,
          fetched_at: cached.rows[0].fetched_at.toISOString(),
          source: "cache",
        };
      }
    }
  } catch (err: any) {
    console.warn(`[fetch-lead-website] cache read failed for ${domain}:`, err?.message);
  }

  // Fresh fetch + summarize
  const raw = await fetchRawSite(domain);
  if (!raw) return null;
  const plain = stripHtmlToText(raw);
  if (plain.length < 200) {
    console.warn(`[fetch-lead-website] ${domain} content too thin (${plain.length} chars)`);
    return null;
  }
  const summary = await summarizeWithHaiku(domain, plain);
  if (!summary) return null;

  // Upsert into cache
  try {
    await pool.query(
      `INSERT INTO lead_website_cache (domain, summary, fetched_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (domain) DO UPDATE SET summary = EXCLUDED.summary, fetched_at = NOW()`,
      [domain, summary]
    );
  } catch (err: any) {
    console.warn(`[fetch-lead-website] cache write failed for ${domain}:`, err?.message);
  }

  return { domain, summary, fetched_at: new Date().toISOString(), source: "fresh" };
}

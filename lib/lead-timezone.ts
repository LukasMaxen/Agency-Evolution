// Best-effort IANA timezone inference from lead enrichment + email domain + company name.
// Used by the auto-reply processor to localize Calendly slot proposals.
// Falls back to the client's defaultTz if no signal is found.

const US_STATE_REGEX = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|\busa\b|united states)\b/i;
const US_PACIFIC_REGEX = /\b(california|oregon|washington state|nevada|seattle|portland|los angeles|san francisco|san diego|bay area)\b/i;
const US_CENTRAL_REGEX = /\b(texas|illinois|chicago|dallas|houston|austin|minneapolis|new orleans|kansas city)\b/i;
const US_MOUNTAIN_REGEX = /\b(colorado|denver|utah|salt lake|arizona|phoenix|albuquerque)\b/i;

const COUNTRY_TLD_TZ: Record<string, string> = {
  uk: "Europe/London",
  au: "Australia/Sydney",
  ca: "America/Toronto",
  nz: "Pacific/Auckland",
  de: "Europe/Berlin",
  fr: "Europe/Paris",
  ie: "Europe/Dublin",
  za: "Africa/Johannesburg",
  sg: "Asia/Singapore",
  ae: "Asia/Dubai",
  in: "Asia/Kolkata",
  nl: "Europe/Amsterdam",
  es: "Europe/Madrid",
  it: "Europe/Rome",
  se: "Europe/Stockholm",
  no: "Europe/Oslo",
  dk: "Europe/Copenhagen",
  ch: "Europe/Zurich",
  at: "Europe/Vienna",
  pl: "Europe/Warsaw",
  lv: "Europe/Riga",
  lt: "Europe/Vilnius",
  ee: "Europe/Tallinn",
  fi: "Europe/Helsinki",
  cz: "Europe/Prague",
  sk: "Europe/Bratislava",
  hu: "Europe/Budapest",
  pt: "Europe/Lisbon",
  gr: "Europe/Athens",
  ro: "Europe/Bucharest",
  bg: "Europe/Sofia",
  tr: "Europe/Istanbul",
  il: "Asia/Jerusalem",
  hk: "Asia/Hong_Kong",
  jp: "Asia/Tokyo",
  kr: "Asia/Seoul",
  br: "America/Sao_Paulo",
  mx: "America/Mexico_City",
};

const COUNTRY_WORD_TZ: Record<string, string> = {
  "united kingdom": "Europe/London",
  "england": "Europe/London",
  "scotland": "Europe/London",
  "wales": "Europe/London",
  "london": "Europe/London",
  "manchester": "Europe/London",
  "australia": "Australia/Sydney",
  "sydney": "Australia/Sydney",
  "melbourne": "Australia/Melbourne",
  "brisbane": "Australia/Brisbane",
  "perth": "Australia/Perth",
  "canada": "America/Toronto",
  "toronto": "America/Toronto",
  "vancouver": "America/Vancouver",
  "new zealand": "Pacific/Auckland",
  "auckland": "Pacific/Auckland",
  "germany": "Europe/Berlin",
  "berlin": "Europe/Berlin",
  "france": "Europe/Paris",
  "paris": "Europe/Paris",
  "ireland": "Europe/Dublin",
  "dublin": "Europe/Dublin",
  "south africa": "Africa/Johannesburg",
  "singapore": "Asia/Singapore",
  "united arab emirates": "Asia/Dubai",
  "dubai": "Asia/Dubai",
  "india": "Asia/Kolkata",
  "netherlands": "Europe/Amsterdam",
  "amsterdam": "Europe/Amsterdam",
  "spain": "Europe/Madrid",
  "italy": "Europe/Rome",
  "sweden": "Europe/Stockholm",
};

// Per-domain manual overrides for leads where TZ can't be inferred from email/enrichment.
// Add entries here when the website TLD is .com but the company is actually based abroad.
// Confirmed by the user from the brand's site footer or "contact us" page.
const DOMAIN_TZ_OVERRIDES: Record<string, string> = {
  "curezma.com": "Australia/Sydney",
};

// Per-domain category overrides for leads where category isn't obvious from the brand name.
// Used by the processor when filling the [CATEGORY] placeholder in templates.
// Add entries here when Claude can't reliably infer (single-product brands, generic names, etc.).
const DOMAIN_CATEGORY_OVERRIDES: Record<string, string> = {
  "curezma.com": "personal care",
};

export function lookupCategoryForDomain(leadEmail: string | null | undefined): string | null {
  if (!leadEmail) return null;
  const m = leadEmail.toLowerCase().match(/@([^>\s]+)$/);
  if (!m) return null;
  return DOMAIN_CATEGORY_OVERRIDES[m[1]] ?? null;
}

export function inferLeadTimezone(opts: {
  enrichment?: string;
  leadEmail?: string | null;
  leadCompany?: string | null;
  defaultTz?: string;
  defaultUsTz?: string;
}): { tz: string; reason: string } {
  const haystack = ((opts.enrichment ?? "") + " " + (opts.leadCompany ?? "")).toLowerCase();
  const usDefault = opts.defaultUsTz ?? "America/New_York";

  // 0. Manual per-domain overrides (highest precedence). Authoritative when set.
  const emailLower = (opts.leadEmail ?? "").toLowerCase();
  const domainMatch = emailLower.match(/@([^>\s]+)$/);
  if (domainMatch) {
    const domain = domainMatch[1];
    if (DOMAIN_TZ_OVERRIDES[domain]) {
      return { tz: DOMAIN_TZ_OVERRIDES[domain], reason: `domain override for ${domain}` };
    }
  }

  // 1. Country / city word match in enrichment or company name (most specific)
  for (const [word, tz] of Object.entries(COUNTRY_WORD_TZ)) {
    if (haystack.includes(word)) return { tz, reason: `matched keyword "${word}"` };
  }

  // 2. US state / city detection
  if (US_STATE_REGEX.test(haystack)) {
    if (US_PACIFIC_REGEX.test(haystack)) return { tz: "America/Los_Angeles", reason: "US west coast match" };
    if (US_MOUNTAIN_REGEX.test(haystack)) return { tz: "America/Denver", reason: "US mountain match" };
    if (US_CENTRAL_REGEX.test(haystack)) return { tz: "America/Chicago", reason: "US central match" };
    return { tz: usDefault, reason: "US match, default EST" };
  }

  // 3. Email TLD (handles .co.uk, .com.au, etc. by taking the last segment)
  const email = (opts.leadEmail ?? "").toLowerCase();
  const tldMatch = email.match(/\.([a-z]{2,3})$/);
  if (tldMatch) {
    const tld = tldMatch[1];
    if (COUNTRY_TLD_TZ[tld]) return { tz: COUNTRY_TLD_TZ[tld], reason: `email TLD .${tld}` };
  }

  return { tz: opts.defaultTz ?? "Europe/London", reason: "no signal, used client default" };
}

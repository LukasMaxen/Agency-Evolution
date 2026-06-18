import pool from "@/lib/db";

// Detects when an inbound "reply" was actually authored by one of OUR own
// sending accounts, i.e. our outbound follow-up got mis-delivered/ingested as if
// a lead had written it. This happens on workspaces that send from many rotating
// domains (e.g. GN Motion's "Peter"/"Romain" personas): the message is sent TO
// the lead and signed by our persona, but lands in the replies table, gets
// classified interested, and the bot tries to reply to our own email.
//
// The clean discriminator is the message AUTHOR (the EmailBison from_email_address),
// not to_email/lead_email which collide on envelope quirks for genuine replies.
// If the author belongs to our own sender infrastructure for that workspace, it is
// our outbound, never a lead reply.

const TTL_MS = 5 * 60 * 1000;

// Free-mail domains are never matched at the domain level. A sender_account on a
// shared provider must match the exact address, so we never drop a real lead who
// happens to use the same provider.
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "aol.com", "gmx.com",
  "gmx.de", "proton.me", "protonmail.com", "web.de", "mail.com",
]);

type SenderSet = { emails: Set<string>; domains: Set<string>; at: number };
const cache = new Map<string, SenderSet>();

async function loadSenders(slug: string): Promise<SenderSet> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  const r = await pool.query(
    `SELECT lower(email) AS email FROM sender_accounts WHERE workspace_slug = $1 AND email IS NOT NULL`,
    [slug]
  );
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const row of r.rows) {
    const addr = (row.email as string).trim();
    if (!addr.includes("@")) continue;
    emails.add(addr);
    const dom = addr.split("@")[1];
    if (dom && !FREEMAIL.has(dom)) domains.add(dom);
  }
  const entry: SenderSet = { emails, domains, at: Date.now() };
  cache.set(slug, entry);
  return entry;
}

/**
 * True when `authorEmail` is one of our own sending addresses for `slug` (exact
 * address match, or a match on one of our dedicated sending domains). Used to
 * drop our own outbound that EmailBison surfaced as an inbound reply.
 */
export async function isOwnSenderAddress(
  slug: string,
  authorEmail: string | null | undefined
): Promise<boolean> {
  if (!authorEmail) return false;
  const addr = authorEmail.trim().toLowerCase();
  if (!addr.includes("@")) return false;

  const { emails, domains } = await loadSenders(slug);
  if (emails.has(addr)) return true;
  const dom = addr.split("@")[1];
  return dom ? domains.has(dom) : false;
}

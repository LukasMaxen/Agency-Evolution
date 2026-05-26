// Two-layer bounce classifier.
//
// Layer 1 (Gmail): subject is dispositive.
//   "Delivery Status Notification (Failure)" -> data_failure
//   "Delivery Status Notification (Delay)"   -> domain_burn
//
// Layer 2 (Microsoft EOP, Postfix, generic): subject only signals "send
// failed". The SMTP code inside text_body distinguishes a bad recipient
// from a domain-reputation block.
//
// Rules below were validated against ~136 real bounces across 16 workspaces
// via scripts/bounce-dry-run.js. Broadened ranges (5.7.x, 5.1.x, 5.4.x) are
// intentional. They catch newer variants like 5.7.509 (DMARC failure) and
// 5.4.x (Postfix routing) that narrower rules would miss.

export type BounceCategory = "data_failure" | "domain_burn" | "soft" | "unknown";
export type BounceProvider = "google" | "microsoft" | "postfix" | "other";

export interface BounceClassification {
  category: BounceCategory;
  provider: BounceProvider;
  matched_rule: string;
  smtp_code: string | null;
}

const GMAIL_FAILURE = /Delivery Status Notification \(Failure\)/i;
const GMAIL_DELAY   = /Delivery Status Notification \(Delay\)/i;
const OUTLOOK_SUBJ  = /^Undeliverable:/i;
const POSTFIX_SUBJ  = /Undelivered Mail Returned to Sender/i;

// Order inside each array matters: most-specific patterns fire first.
const DOMAIN_BURN_PATTERNS: RegExp[] = [
  /\b5\.7\.\d+\b/,                      // catches 5.7.1, 5.7.509 (DMARC), 5.7.606 (RBL), 5.7.708 (throttle)
  /\b4\.7\.500\b/,                      // EOP anti-spam throttle
  /\bClient host blocked\b/i,
  /\b451\b.*(?:rate|throttl|spam|block)/i,
];

const DATA_FAILURE_PATTERNS: RegExp[] = [
  /\b5\.1\.\d+\b/,                      // 5.1.1 mailbox doesn't exist, 5.1.10 recipient rejected, etc.
  /\bUser Unknown\b/i,
  /\bwasn'?t found at\b/i,              // EOP plain-English form
  /\b5\.2\.\d+\b/,                      // mailbox full / over quota / suspended
  /\b5\.4\.\d+\b/,                      // Postfix routing / DNS failures
];

const SOFT_PATTERNS: RegExp[] = [
  /\b4\.\d+\.\d+\b/,                    // any other transient 4xx
  /\bmailbox full\b/i,                  // plain-English when no code present
];

function extractSmtpCode(body: string): string | null {
  const m = body.match(/\b([45]\.\d+\.\d+)\b/);
  return m ? m[1] : null;
}

function detectProvider(fromEmail: string, body: string): BounceProvider {
  const f = (fromEmail || "").toLowerCase();
  if (f.includes("googlemail.com") || f.endsWith("@google.com")) return "google";
  if (f.startsWith("postmaster@") || /Microsoft SMTP|Office 365|EOP/i.test(body)) return "microsoft";
  if (f.startsWith("mailer-daemon@") || /Postfix/i.test(body)) return "postfix";
  return "other";
}

export function classifyBounce(args: {
  subject: string | null;
  textBody: string | null;
  fromEmail: string | null;
}): BounceClassification {
  const subject  = args.subject ?? "";
  const body     = args.textBody ?? "";
  const from     = args.fromEmail ?? "";
  const smtp     = extractSmtpCode(body);
  const provider = detectProvider(from, body);

  if (GMAIL_FAILURE.test(subject)) {
    return { category: "data_failure", provider: "google", matched_rule: "gmail_failure_subject", smtp_code: smtp };
  }
  if (GMAIL_DELAY.test(subject)) {
    return { category: "domain_burn", provider: "google", matched_rule: "gmail_delay_subject", smtp_code: smtp };
  }

  const isBodyDriven =
    OUTLOOK_SUBJ.test(subject) || POSTFIX_SUBJ.test(subject) ||
    provider === "microsoft" || provider === "postfix";

  if (isBodyDriven) {
    for (const re of DOMAIN_BURN_PATTERNS) {
      if (re.test(body)) return { category: "domain_burn", provider, matched_rule: re.source, smtp_code: smtp };
    }
    for (const re of DATA_FAILURE_PATTERNS) {
      if (re.test(body)) return { category: "data_failure", provider, matched_rule: re.source, smtp_code: smtp };
    }
    for (const re of SOFT_PATTERNS) {
      if (re.test(body)) return { category: "soft", provider, matched_rule: re.source, smtp_code: smtp };
    }
  }

  return { category: "unknown", provider, matched_rule: "no_rule_matched", smtp_code: smtp };
}

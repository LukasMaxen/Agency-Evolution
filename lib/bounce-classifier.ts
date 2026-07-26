// Two-layer bounce classifier.
//
// Layer 1 (Gmail Failure): subject is dispositive — permanent recipient
//   failure (bad address).
//
// Layer 2 (Gmail Delay, Microsoft EOP, Postfix, generic): subject only
//   signals "send failed". The SMTP code in text_body distinguishes a
//   recipient-side problem from a domain-reputation block.
//
// Rules validated against ~70 real Gmail (Delay) rows + 100+ Outlook
// Undeliverable rows via scripts/bounce-dry-run.js. SMTP-code patterns
// are context-anchored (must follow a 3-digit response code like 451 or
// 550) so stray "4.7.x" substrings inside IPs or hashes don't trigger
// burn classification.

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

// Recipient-side permission / config blocks. These look like burn signals
// (often carry 5.7.x codes) but are actually permanent list-quality issues:
// the recipient configured their account or group to reject our sender.
// Cleaning the list is the action, not pausing our domain.
const RECIPIENT_POLICY_BLOCK = /(?:isn'?t set up to receive|only accepts messages from|Sender not allowed|Action Required[^a-z]{0,30}Sender not allowed|not authorized to send|external forwarding|your organization does not allow|couldn'?t be forwarded|forwarding (?:is )?(?:disabled|blocked|not allowed))/i;

// Third-party security filters (Mimecast, Proofpoint, Barracuda, etc.)
// rejecting our sender. These ARE deliverability signals on our domain —
// the recipient's security gateway is flagging our content/sender.
const THIRD_PARTY_SECURITY_BLOCK = /(?:Message blocked|rejected due to security polic|554[^\n]{0,80}security|content[^\n]{0,30}block|filtered as spam|sender (?:reputation|blocked))/i;

// Domain burn (our reputation is being penalised).
// Context-anchored: must be a real SMTP response code, not stray digits.
const DOMAIN_BURN_PATTERNS: RegExp[] = [
  // 5.7.x policy class, prefixed by a 5xx response code (550 5.7.509, 554 5.7.1, etc.)
  /(?:^|[\s>'"])(?:5\d\d)[\s-]+5\.7\.\d+\b/i,
  // 4.7.x policy class, prefixed by 421 or 45x (421 4.7.28, 451 4.7.0, etc.)
  /(?:^|[\s>'"])(?:421|45\d)[\s-]+4\.7\.\d+\b/i,
  // Microsoft EOP anti-spam throttle (specific code, common phrasing)
  /\b4\.7\.500\b/i,
  // Explicit policy / throttle phrases when no SMTP code present
  /\bClient host blocked\b/i,
  /\b(?:unsolicited|bulk mail|unusual rate of)\b/i,
  /\bnot whitelisted\b/i,
  /\blisted in (?:block|black)list\b/i,
  /\bpolicy violation\b/i,
  /\b(?:blacklisted|blocklisted)\b/i,
  /\b421\b[^\n]{0,80}?(?:rate|throttl|spam|block)/i,
];

// Recipient-side permanent failure (bad address, mailbox full, etc.).
const DATA_FAILURE_PATTERNS: RegExp[] = [
  /(?:^|[\s>'"])(?:5\d\d)[\s-]+5\.1\.\d+\b/i,          // 5.1.x mailbox doesn't exist
  /(?:^|[\s>'"])(?:5\d\d)[\s-]+5\.2\.\d+\b/i,          // 5.2.x mailbox full / suspended
  /(?:^|[\s>'"])(?:5\d\d)[\s-]+5\.4\.\d+\b/i,          // 5.4.x routing
  /\bUser Unknown\b/i,
  /\bwasn'?t found at\b/i,                              // EOP plain-English form
];

// Recipient-side transient failure. Includes the dominant Gmail (Delay)
// 4.4.x recipient-routing failures and the no-SMTP-code "recipient server
// did not accept" / DNS error messages.
const SOFT_PATTERNS: RegExp[] = [
  /(?:^|[\s>'"])(?:421|45\d)[\s-]+4\.[1-6]\.\d+\b/i,    // 4.x.x transient (but not 4.7.x — that's burn)
  /\bmailbox full\b/i,
  /recipient server did not accept/i,
  /DNS Error/i,
  /MX.*lookup/i,
  /\bcouldn'?t (?:be|connect|deliver)/i,
];

function extractSmtpCode(body: string): string | null {
  const m = body.match(/(?:^|[\s>'"])(?:[245]\d\d)[\s-]+([45]\.\d+\.\d+)\b/i);
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

  // STEP 1: Recipient-side permission / config blocks. These often carry
  // policy-class SMTP codes (5.7.x) but the recipient or their org is the
  // one rejecting us, not the mail provider's reputation system. Treat as
  // permanent list-quality issues (data_failure). Check first so 5.7.x
  // patterns later don't misroute them to burn.
  if (RECIPIENT_POLICY_BLOCK.test(body)) {
    return { category: "data_failure", provider, matched_rule: "recipient_policy_block", smtp_code: smtp };
  }

  // STEP 2: Gmail (Failure). Default is data_failure (bad recipient), but
  // if the body wraps a third-party security filter rejection (Mimecast,
  // Proofpoint, etc.), that IS our domain being blocked at the recipient's
  // perimeter — escalate to burn.
  if (GMAIL_FAILURE.test(subject)) {
    if (THIRD_PARTY_SECURITY_BLOCK.test(body)) {
      return { category: "domain_burn", provider: "google", matched_rule: "gmail_failure_third_party_security", smtp_code: smtp };
    }
    return { category: "data_failure", provider: "google", matched_rule: "gmail_failure_subject", smtp_code: smtp };
  }

  // STEP 3: Body-driven branch (Gmail Delay, Outlook Undeliverable,
  // Postfix, generic microsoft/postfix providers). Subject alone is too
  // ambiguous to classify; the SMTP code in the body is what distinguishes
  // recipient issues from our reputation.
  const isBodyDriven =
    GMAIL_DELAY.test(subject) ||
    OUTLOOK_SUBJ.test(subject) ||
    POSTFIX_SUBJ.test(subject) ||
    provider === "microsoft" ||
    provider === "postfix";

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
    // Gmail (Delay) is a delivery failure regardless of which exact phrase
    // matched. Default to soft (transient/recipient-side) since the burn
    // patterns above did not fire.
    if (GMAIL_DELAY.test(subject)) {
      return { category: "soft", provider: "google", matched_rule: "gmail_delay_default_soft", smtp_code: smtp };
    }
  }

  return { category: "unknown", provider, matched_rule: "no_rule_matched", smtp_code: smtp };
}

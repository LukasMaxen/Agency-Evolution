// Shared unconfirmed-fee-claim guard.
//
// The model reaches for "no retainer, no upfront cost, we only get paid when the deal
// closes" as a reassuring default for any M&A-shaped client. It has been false every
// time it was caught: Larsen Digital, Acceler8rs, and ACT Capital (CLEW Pouches
// 2026-09-04, bba315 2026-10-19, corrected by ACT's Kevin Outcalt: ACT charges a
// monthly service fee). Deterministic backstop at every AI send gate (auto-reply and
// follow-ups). Only a client file carrying `fee_claims_confirmed: true` may say it.
//
// Client-file flags (put them in the REPLY QUICK REFERENCE):
//   fee_claims_confirmed: true    the file's fee claims are real, skip the claim check
//   fee_questions_to_manual: true any lead asking about our fees goes to a human, no draft

const FEE_CLAIM_PATTERNS: RegExp[] = [
  // "no upfront costs", "nothing upfront", "zero up-front fees"
  /\b(?:no|nothing|zero)\s+(?:upfront|up-front|up front)\b/i,
  /\bno (?:upfront|up-front|up front)?\s*(?:costs?|fees?|payments?|charges?)\s+(?:upfront|up-front|up front|unless|until|before)\b/i,
  // "no retainer", "not a retainer", "without a retainer", "retainer-free"
  /\bno (?:monthly )?retainers?\b/i,
  /\bnot (?:on )?a retainer\b/i,
  /\bwithout (?:a |any )?retainer\b/i,
  /\bretainer[- ]free\b/i,
  // "we don't charge a retainer / anything upfront", "never charge a retainer"
  /\b(?:don'?t|do not|never|won'?t|will not)\s+(?:charge|require|take|ask for)\s+(?:a |any |an )?(?:retainer|upfront|up-front|up front|anything (?:upfront|up-front|up front|until|unless))/i,
  // "success-fee only", "on a success fee basis", "purely commission", "contingency basis"
  /\b(?:success[- ]?fee|commission|contingency|performance)[- ](?:only|basis|based)\b/i,
  /\b(?:purely|strictly|entirely|100%)\s+(?:on )?(?:a )?(?:success[- ]?fee|commission|contingency|performance)\b/i,
  /\bon a (?:pure |purely )?(?:success[- ]?fee|commission|contingency)\b/i,
  // "we only get paid when a deal closes", "you don't pay anything until"
  /\bonly (?:get )?(?:paid|charge|earn)\b[^.]{0,40}\b(?:if|when|once|at|on|after)\b/i,
  /\b(?:don'?t|do not|won'?t|will not|never)\s+pay\s+(?:us\s+)?(?:anything|a (?:thing|cent|dime|penny))\b/i,
  // "no cost to you", "costs you nothing", "free unless it closes"
  /\bno cost (?:to you|unless|until)\b/i,
  /\bcosts? you nothing\b/i,
  /\bfree (?:unless|until)\b/i,
  // "our fee comes from the transaction proceeds at closing"
  /\b(?:fee|paid|payment)s?\b[^.]{0,40}\b(?:out of|from)\s+(?:the\s+)?(?:transaction|deal|sale)\s+proceeds\b/i,
  /\bno fees? (?:unless|until)\b/i,
];

/** Returns the offending phrase if the body makes a fee claim the client file has not confirmed. */
export function containsUnconfirmedFeeClaim(body: string, clientFileText: string): string | null {
  if (!body || /fee_claims_confirmed:\s*true/i.test(clientFileText || "")) return null;
  for (const p of FEE_CLAIM_PATTERNS) {
    const m = body.match(p);
    if (m) return m[0];
  }
  return null;
}

/**
 * True if the lead is asking what WE charge (fees, retainer, commission, "do we need to
 * pay you"). Deliberately excludes bare "price"/"valuation": a buyer asking the price of
 * a company for sale is a deal question, not a fee question.
 */
export function asksAboutOurFees(leadText: string): boolean {
  if (!leadText) return false;
  return /\b(?:retainers?|upfront fees?|up-front fees?|commissions?|your fees?|fee structure|what (?:do|would) you charge|how (?:do|are) you (?:get )?paid|how (?:does|do) (?:your|the) (?:fee|pricing|compensation)|pay (?:for )?your services|pay you|cost (?:us|me) anything|is there a (?:fee|cost|charge)|any (?:fees?|costs?|charges?))\b/i.test(leadText);
}

export function feeQuestionsToManual(clientFileText: string): boolean {
  return /fee_questions_to_manual:\s*true/i.test(clientFileText || "");
}

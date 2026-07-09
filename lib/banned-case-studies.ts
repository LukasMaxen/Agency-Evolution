// Shared deactivated-case-study guard.
//
// These case studies are deactivated everywhere and must NEVER appear in an
// outbound email, for any client, from any draft path (auto-reply, follow-up,
// Slack approve/regenerate, or the dashboard manual composer). The names used to
// leak cross-client (Motel Margarita, KyiKyi, and Headwaters Studio were all
// shared between Larsen Digital + Acceler8rs). Client files were scrubbed, but
// this is the deterministic backstop enforced at every send gate so a stale line,
// a recycled example, or a model hallucination can never actually reach a lead.
//
// See clients/_deactivated-case-studies.md for the archive + restore steps.
// To reactivate one: remove it from BANNED_CASE_STUDIES here AND restore the
// client-file lines from the archive.

export const BANNED_CASE_STUDIES = [
  "motel margarita",
  "kyikyi",
  "kyi kyi",
  "headwaters",
];

/**
 * Returns the matched banned case-study name if the text references one, else null.
 * Matching is case-insensitive and tolerant of spacing/punctuation, so email/handle
 * forms and reformatted names ("Kyi-Kyi", "KYIKYI", "Headwaters Studio") still match.
 */
export function containsBannedCaseStudy(text: string): string | null {
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  for (const name of BANNED_CASE_STUDIES) {
    if (normalized.includes(name.replace(/[^a-z0-9]+/g, " "))) return name;
  }
  return null;
}

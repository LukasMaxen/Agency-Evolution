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

// The deactivated case studies' NUMERIC signatures. Drafts sometimes cite the results
// WITHOUT the brand name (e.g. "£25k to £102k a month in 90 days"), which the name
// check misses (Aurra London incident, 2026-07-17). These figure patterns are the
// specific £ numbers for each retired case study and do NOT overlap the approved
// anonymous US results ($0→$850k/mo in 4 months, $152k→$1.1M/mo in 13 months), so
// they will not false-positive on a legitimate reply. Label describes which study.
const BANNED_CASE_STUDY_FIGURES: Array<{ label: string; re: RegExp }> = [
  { label: "motel-margarita-figures", re: /25k[^.]{0,15}102k|102k[^.]{0,20}90\s*days/i },
  { label: "kyikyi-figures", re: /13k[^.]{0,15}140k|140k[^.]{0,20}60\s*days/i },
  { label: "headwaters-figures", re: /60k[^.]{0,15}(?:£1m|1m|1\s*million)[^.]{0,20}24\s*months|60k\s*(?:a|per|\/)?\s*year[^.]{0,25}(?:£1m|1m)/i },
];

/**
 * Returns the matched banned case-study (name or figure signature) if the text
 * references one, else null. Matching is case-insensitive and tolerant of spacing/
 * punctuation, so name forms ("Kyi-Kyi", "Headwaters Studio") and the results cited
 * without the name ("£25k to £102k a month in 90 days") are both caught.
 */
export function containsBannedCaseStudy(text: string): string | null {
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  for (const name of BANNED_CASE_STUDIES) {
    if (normalized.includes(name.replace(/[^a-z0-9]+/g, " "))) return name;
  }
  for (const { label, re } of BANNED_CASE_STUDY_FIGURES) {
    if (re.test(text)) return label;
  }
  return null;
}

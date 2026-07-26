import { readFileFromGitHub, commitFileToGitHub } from "@/lib/github-commit";

// Shared core for applying weekly-review patterns to the markdown rule files.
// Used by both the human-gated ✅ flow in app/api/slack/events/route.ts and the
// unattended auto-apply flow for client-managed workspaces (e.g. sonaro-ai) in
// app/api/feedback/weekly-review/route.ts. Keeping the commit path in one place
// means both routes resolve targets, merge, and commit identically.

export interface WeeklyReviewPattern {
  title: string;
  examples_count: number;
  proposed_rule_change: string;
  target_file: string;
  confidence: string;
}

export interface WeeklyReviewSummary {
  headline: string;
  patterns: WeeklyReviewPattern[];
  one_off_notes: string[];
}

export interface AppliedFile {
  file: string;
  commitUrl: string;
  titles: string[];
}

export interface ApplyResult {
  applied: AppliedFile[];
  failed: string[];
  skippedTargets: string[];
}

/**
 * Map a Claude-suggested target_file string to the actual repo path of the file
 * that gets edited. Returns null if the target is unsupported.
 *
 * Supported formats:
 *   - "CONTEXT_Replies.md", "CONTEXT_FollowUps.md", "SKILL_Reply-Management.md", "SKILL_FollowUps.md"
 *   - "clients/<slug>.md" (per-client rules)
 *   - "prompts/extras/<slug>.md" (per-workspace processor system-prompt learnings)
 *
 * Slug must match [a-z0-9-]+ for safety (no path traversal, no arbitrary writes).
 */
export function resolveTargetPath(target: string): string | null {
  const raw = target.trim();
  const t = raw.toLowerCase();
  if (t.includes("context_replies")) return "1. Departments/reply-management/CONTEXT_Replies.md";
  if (t.includes("context_followups")) return "1. Departments/follow-up-management/CONTEXT_FollowUps.md";
  if (t.includes("skill_followups")) return "1. Departments/follow-up-management/SKILL_FollowUps.md";
  if (t.includes("skill_reply")) return "1. Departments/reply-management/SKILL_Reply-Management.md";

  // clients/<slug>.md — per-client rules
  const clientMatch = raw.match(/^clients\/([a-z0-9-]+)\.md$/i);
  if (clientMatch) return `clients/${clientMatch[1].toLowerCase()}.md`;

  // prompts/extras/<slug>.md — per-workspace processor system-prompt learnings
  const extrasMatch = raw.match(/^prompts\/extras\/([a-z0-9-]+)\.md$/i);
  if (extrasMatch) return `prompts/extras/${extrasMatch[1].toLowerCase()}.md`;

  return null;
}

/**
 * Managed heading under which weekly-review and send-time learnings are appended.
 * Created once at the end of the target file and reused thereafter, so every new
 * entry accumulates beneath it and the newest rule always wins if it overrides an
 * older one.
 */
export const LEARNINGS_HEADING = "## Weekly Review Learnings (auto-applied, apply always)";

/**
 * Deterministically append approved patterns to a markdown rule file and return
 * the full new file content.
 *
 * This replaces the previous "ask Claude to regenerate the whole file" merge,
 * which timed out or hit the 16k output-token cap on large files (e.g.
 * CONTEXT_Replies.md, ~14k tokens) and had no truncation guard, so a clipped
 * response could silently overwrite existing rules. Appending is pure string
 * work: it cannot time out, truncate, or delete existing content, and costs no
 * tokens. Each pattern becomes a dated subsection under LEARNINGS_HEADING.
 *
 * dateStr is passed in (YYYY-MM-DD) so this stays pure and testable.
 */
export function appendPatternsToFile(
  existingContent: string,
  patterns: WeeklyReviewPattern[],
  threadComments: string,
  dateStr: string
): string {
  const entries = patterns
    .map(p => `### ${dateStr}: ${p.title.trim()}\n\n${p.proposed_rule_change.trim()}`)
    .join("\n\n");

  const note = threadComments.trim()
    ? `\n\n_Reviewer notes: ${threadComments.trim().replace(/\s+/g, " ")}_`
    : "";

  const base = existingContent.replace(/\s+$/, "");
  const heading = existingContent.includes(LEARNINGS_HEADING) ? "" : `\n\n${LEARNINGS_HEADING}`;

  return `${base}${heading}\n\n${entries}${note}\n`;
}

/**
 * Resolve each pattern to its target file, merge via Claude, and commit each
 * changed file via the GitHub Contents API. Pure of any Slack/DB side effects so
 * callers own how results are surfaced (thread reply vs. notification) and how
 * the weekly_reviews row is marked.
 */
export async function commitReviewPatterns(
  patterns: WeeklyReviewPattern[],
  threadComments: string,
  reviewerName: string,
  commitFooter: string,
  dateStr: string
): Promise<ApplyResult> {
  const patternsByFile = new Map<string, WeeklyReviewPattern[]>();
  const skippedTargets: string[] = [];

  for (const p of patterns) {
    const path = resolveTargetPath(p.target_file);
    if (!path) {
      skippedTargets.push(`${p.title} (target ${p.target_file} not auto-applicable)`);
      continue;
    }
    if (!patternsByFile.has(path)) patternsByFile.set(path, []);
    patternsByFile.get(path)!.push(p);
  }

  const applied: AppliedFile[] = [];
  const failed: string[] = [];

  for (const [filePath, filePatterns] of patternsByFile.entries()) {
    const file = await readFileFromGitHub(filePath);
    if (!file) {
      failed.push(`${filePath}: could not read from GitHub`);
      continue;
    }

    const newContent = appendPatternsToFile(file.content, filePatterns, threadComments, dateStr);
    if (newContent === file.content) {
      console.log(`[apply-weekly-review] No changes generated for ${filePath}, skipping`);
      continue;
    }

    const commitMessage = `Apply weekly review patterns by ${reviewerName}\n\n${filePatterns.map(p => `- ${p.title}`).join("\n")}\n\n${commitFooter}`;
    const commitUrl = await commitFileToGitHub(filePath, newContent, commitMessage, file.sha);
    if (!commitUrl) {
      failed.push(`${filePath}: commit failed`);
      continue;
    }
    applied.push({ file: filePath, commitUrl, titles: filePatterns.map(p => p.title) });
  }

  return { applied, failed, skippedTargets };
}

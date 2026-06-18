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
 * Use Claude to merge proposed patterns into an existing markdown file.
 * Returns the full new file content, or null on error.
 */
export async function applyPatternsToFile(
  existingContent: string,
  patterns: WeeklyReviewPattern[],
  threadComments: string
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const systemPrompt = `You are editing a markdown documentation file. You will receive the current full file contents and one or more proposed rule changes. Apply each proposed change to the file by inserting or modifying text in the right section. Preserve all existing content exactly. Add the new content under the most appropriate existing heading, or create a new subsection if needed.

OUTPUT: the complete new file content, nothing else. No preamble, no fences, no commentary. Just the full file as it should look after your edits.`;

  const patternsBlock = patterns.map((p, i) =>
    `Pattern ${i + 1}: ${p.title}\nTarget: ${p.target_file}\nConfidence: ${p.confidence}\nProposed rule change:\n${p.proposed_rule_change}`
  ).join("\n\n---\n\n");

  const userMessage = `EXISTING FILE CONTENT:
${existingContent}

PROPOSED PATTERN(S) TO APPLY:
${patternsBlock}

${threadComments ? `HUMAN INSTRUCTIONS FROM THE REVIEW THREAD (apply these as filters or refinements):\n${threadComments}\n\n` : ""}Output the full revised file content now.`;

  const applyController = new AbortController();
  const applyTimeout = setTimeout(() => applyController.abort(), 120_000);

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: applyController.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") console.error("[apply-patterns] Claude timed out after 120s");
    else console.error("[apply-patterns] Claude fetch error:", err?.message);
    return null;
  } finally {
    clearTimeout(applyTimeout);
  }
  if (!response.ok) {
    console.error("[apply-patterns] Claude error:", response.status, await response.text());
    return null;
  }
  const data = await response.json();
  const text = (data.content?.[0]?.text ?? "").trim();
  // If the model wrapped the file in fences, strip them.
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : text;
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
  commitFooter: string
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

    const newContent = await applyPatternsToFile(file.content, filePatterns, threadComments);
    if (!newContent) {
      failed.push(`${filePath}: Claude could not generate the merged file`);
      continue;
    }
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

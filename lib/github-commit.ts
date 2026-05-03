/**
 * GitHub commit helper used by the weekly-review auto-apply flow.
 * Reads, modifies, and commits a markdown file via the GitHub Contents API.
 *
 * Required env vars:
 * - GITHUB_TOKEN: a fine-grained personal access token with Contents: Read+Write
 *   on the Agency-Evolution repo
 * - GITHUB_REPO: owner/name of the repo (defaults to LukasMaxen/Agency-Evolution)
 */

const DEFAULT_REPO = "LukasMaxen/Agency-Evolution";
const DEFAULT_BRANCH = "main";

interface FileResponse {
  sha: string;
  content: string;
  encoding: string;
  path: string;
  html_url?: string;
}

/**
 * Read the current contents of a file from the GitHub repo's main branch.
 * Returns the decoded file body and its sha (needed for the next update).
 */
export async function readFileFromGitHub(filePath: string): Promise<{
  content: string;
  sha: string;
} | null> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO ?? DEFAULT_REPO;
  if (!token) {
    console.error("[github-commit] GITHUB_TOKEN not set");
    return null;
  }

  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filePath)}?ref=${DEFAULT_BRANCH}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    console.error("[github-commit] readFile failed:", response.status, await response.text());
    return null;
  }
  const data = (await response.json()) as FileResponse;
  if (data.encoding !== "base64") {
    console.error("[github-commit] unexpected encoding:", data.encoding);
    return null;
  }
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha };
}

/**
 * Commit a new version of a file to the repo's main branch via the Contents API.
 * Coolify will pick up the new commit on its next deploy webhook.
 *
 * Returns the commit URL on success, null on failure.
 */
export async function commitFileToGitHub(
  filePath: string,
  newContent: string,
  commitMessage: string,
  expectedSha: string
): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO ?? DEFAULT_REPO;
  if (!token) {
    console.error("[github-commit] GITHUB_TOKEN not set");
    return null;
  }

  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filePath)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(newContent, "utf-8").toString("base64"),
      sha: expectedSha,
      branch: DEFAULT_BRANCH,
    }),
  });
  if (!response.ok) {
    console.error("[github-commit] commitFile failed:", response.status, await response.text());
    return null;
  }
  const data = (await response.json()) as { commit?: { html_url?: string } };
  return data.commit?.html_url ?? "committed";
}

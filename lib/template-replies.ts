import fs from "fs";
import path from "path";

export type TemplatePath = "interested" | "template" | "no_action" | "manual";

/**
 * Maps a Haiku-classified intent to a tier-2 routing decision.
 * Edit only when adding a new intent category.
 */
export const INTENT_TO_PATH: Record<string, TemplatePath> = {
  // Sonnet path: needs real personalisation
  interested_urgent: "interested",
  interested: "interested",
  needs_info: "interested",
  neutral: "interested",
  forwarded: "interested",
  advisor_engaged: "interested",

  // These intents go through Sonnet. Templates exist as reference only.
  // The processor bypasses the approval gate for these and auto-sends directly.
  not_interested: "interested",
  hard_no: "interested",
  unsubscribe: "interested",
  wrong_target: "interested",
  hostile: "interested",

  // Manual path: post to #manual-replies. Used only when a physical action is
  // required that the AI cannot perform itself (move a calendar event, place a
  // phone call, complete a third-party intake form). Anything that is just an
  // email reply belongs on the Sonnet path so it can flow through reply-approval.
  reschedule_request: "manual",
  phone_call_requested: "manual",
  their_process_required: "manual",

  // No-action path: log only, no send
  out_of_office: "no_action",
  bounce: "no_action",
  spam: "no_action",
  nothing_to_address: "no_action",
  automated_notice: "no_action",
};

/**
 * Maps a classified intent to a template filename (without .md extension).
 * The processor falls back to soft-no-acknowledgment if a template is missing,
 * but a missing mapping here means the intent is template-eligible without a target.
 */
export const INTENT_TO_TEMPLATE: Record<string, string> = {
  not_interested: "soft-no-acknowledgment",
  hard_no: "hard-no-acknowledgment",
  unsubscribe: "unsubscribe-confirmation",
  wrong_target: "wrong-target-apology",
  hostile: "hostile-acknowledgment",
};

/**
 * Per-intent reason text shown on the #manual-replies card for manual-path intents.
 * Keeps the Slack card concise and tells the team what action to take.
 */
export const MANUAL_INTENT_REASONS: Record<string, string> = {
  reschedule_request: "Lead has booked and wants to move the meeting. Cancel the existing slot and rebook to the new time.",
  phone_call_requested: "Lead provided a phone number and wants a call directly. Call the number in the reply, do not send Calendly.",
  their_process_required: "Lead is redirecting us into their own intake form or external application process. Decide whether to comply (fill out their form by hand) or skip.",
};

interface TemplateFrontmatter {
  name?: string;
  intents?: string[];
  description?: string;
}

interface LoadedTemplate {
  name: string;
  body: string;
  frontmatter: TemplateFrontmatter;
}

const TEMPLATES_DIR = "1. Departments/reply-management/templates";

/**
 * Load a template by name from the markdown templates folder. Returns null if missing.
 * Strips YAML frontmatter, returns just the body.
 */
export function loadTemplate(name: string): LoadedTemplate | null {
  const filePath = path.join(process.cwd(), TEMPLATES_DIR, `${name}.md`);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    console.error(`[template-replies] template not found: ${name}.md`);
    return null;
  }

  // Parse simple YAML frontmatter delimited by --- lines.
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  let frontmatter: TemplateFrontmatter = {};
  let body = raw;

  if (match) {
    body = match[2].trim();
    const fmText = match[1];
    const lines = fmText.split("\n");
    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      let value: any = line.slice(colonIdx + 1).trim();
      if (value.startsWith("[") && value.endsWith("]")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);
      }
      (frontmatter as any)[key] = value;
    }
  } else {
    body = raw.trim();
  }

  return { name, body, frontmatter };
}

export interface TemplateVars {
  lead_first_name?: string;
  lead_full_name?: string;
  lead_company?: string;
  lead_email?: string;
  sender_email?: string;
  workspace_name?: string;
}

/**
 * Substitute {{variable}} placeholders in a template body.
 * Unknown variables are left as-is so missing data is visible rather than silent.
 * Never substitute {SENDER_EMAIL_SIGNATURE}, that uses single braces and is
 * resolved by EmailBison at send time.
 */
export function substituteVars(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{([\w_]+)\}\}/g, (full, key: string) => {
    const v = (vars as any)[key];
    return v == null || v === "" ? full : String(v);
  });
}

/**
 * Extract the lead's first name from a full name string. Falls back to "there".
 */
export function firstName(fullName: string | null | undefined): string {
  if (!fullName) return "there";
  const parts = fullName.trim().split(/\s+/);
  return parts[0] ?? "there";
}

/**
 * Convert a workspace slug (eg "statera-capital") to a display name (eg "Statera Capital").
 */
export function slugToWorkspaceName(slug: string): string {
  return slug
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Build the variable map from a reply row + workspace slug.
 */
export function varsFromReply(reply: Record<string, any>, workspaceSlug: string): TemplateVars {
  return {
    lead_first_name: firstName(reply.lead_name),
    lead_full_name: reply.lead_name ?? "",
    lead_company: reply.lead_company ?? "",
    lead_email: reply.lead_email ?? "",
    sender_email: reply.sender_email ?? "",
    workspace_name: slugToWorkspaceName(workspaceSlug),
  };
}

/**
 * Render a template by name with the given variables. Returns null on missing template.
 */
export function renderTemplate(templateName: string, vars: TemplateVars): string | null {
  const tmpl = loadTemplate(templateName);
  if (!tmpl) return null;
  return substituteVars(tmpl.body, vars);
}

/**
 * Days between FU steps. Cadence per CONTEXT_FollowUps.md:
 * - Full: 2 days to FU1, then 7 days between each step, except FU5 to FU6 = 14 days
 * - Abbreviated: 2 days to FU1, then 7 days to FU2 (the break-up)
 * Returns the number of days until the NEXT step, given the step that was just sent.
 */
export function daysUntilNextStep(
  sequenceType: "full" | "abbreviated" | "none",
  stepJustSent: number
): number {
  if (sequenceType === "full" && stepJustSent === 5) return 14;
  return 7;
}

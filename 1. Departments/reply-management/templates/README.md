# Reply Templates

These templates power the **template tier** of the two-tier auto-reply flow. They are deterministic, near-zero cost (no AI call for the body), and handle every reply type that does not need personalisation.

## How the two tiers work

1. **Tier 1 (cheap classification):** Every inbound reply hits the auto-reply processor. A Haiku call (~$0.001) classifies the intent into one of these buckets:
   - `interested_urgent`, `interested`, `needs_info`, `neutral` → **Sonnet path** (full draft via `CONTEXT_Replies.md`)
   - `forwarded` (someone other than the original lead is replying) → **Sonnet path** (needs personalisation + recipient override)
   - `not_interested`, `hard_no`, `unsubscribe`, `wrong_target` → **template path** (this folder)
   - `out_of_office`, `bounce`, `spam` → **no action** (logged in DB, no send)

2. **Tier 2 (template or Sonnet):**
   - Template path: load the matching template file from this folder, substitute variables, send via EmailBison. No AI involved in the body.
   - Sonnet path: full draft via Claude using `CONTEXT_Replies.md`, optional team approval in `#reply-approval`.

## Template file format

Each template is a markdown file with YAML frontmatter:

```markdown
---
name: template-id
intents: [intent_a, intent_b]
description: When this template fires.
---
Body text with {{variables}}.
```

The `intents` array defines which classified intents map to this template. The `name` is unique. The body comes after the frontmatter and supports variable substitution.

## Available variables

| Variable | Source |
|---|---|
| `{{lead_first_name}}` | First word of `replies.lead_name`, falls back to "there" |
| `{{lead_full_name}}` | `replies.lead_name` |
| `{{lead_company}}` | `replies.lead_company` |
| `{{lead_email}}` | `replies.lead_email` |
| `{{sender_email}}` | `replies.sender_email` |
| `{{workspace_name}}` | Slug-cased workspace name (eg "Statera Capital") |

The literal placeholder `{SENDER_EMAIL_SIGNATURE}` is preserved as-is, EmailBison substitutes it at send time with the sender's full signature block.

## Editing templates

Just edit the markdown file. No deploy needed for content changes (the file is read at request time on the server). For structural changes (new variable, new intent), I will help wire it up in code.

## Tone rules

All templates follow the same tone rules as `CONTEXT_Replies.md`:

- No em dashes, en dashes, or double hyphens
- No colons in the body
- No filler phrases
- Match the brevity of the lead's reply
- End with `{SENDER_EMAIL_SIGNATURE}` on its own line, no "Best," or name above it

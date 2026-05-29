# Per-Workspace System Prompt Extras

Files in this directory are loaded by the auto-reply processor at runtime and appended to the system prompt for a specific workspace. Use them to accumulate workspace-specific learnings without modifying the core system prompt in `app/api/auto-reply/processor.ts`.

## How it works

1. The processor loads `prompts/extras/{workspace_slug}.md` when handling a reply for that workspace.
2. The contents are appended to the system prompt as a `WORKSPACE-SPECIFIC LEARNINGS` block.
3. The weekly review (Monday morning) can auto-commit new learnings here when you approve a pattern in `#feedback-review`.

## Naming

One file per workspace slug, e.g.:
- `larsen-digital.md` for Larsen Digital
- `acceler8rs.md` for Acceler8rs
- `agency-evolution.md` for the Maxen Group / Agency Evolution workspace

## Why per-workspace, not global

A Larsen-specific rule (e.g. "always send Calendly even when lead gives a day") should never leak into other clients' replies. Per-workspace files scope learnings cleanly. If a learning applies to all clients, put it in `1. Departments/reply-management/CONTEXT_Replies.md` instead.

## Manual edits

Safe to edit by hand. Keep entries short, declarative, and grouped by topic. The processor appends the full file contents, so length matters for prompt-token cost.

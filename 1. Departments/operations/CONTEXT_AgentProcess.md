# Agent Process Context

How Claude should approach work in this repo. Applies to every task, every session.

---

## Before starting any task

1. Read the relevant memory entries (the auto-memory index).
2. Read the relevant department CONTEXT file (e.g. `CONTEXT_Replies.md`, `CONTEXT_Campaign.md`).
3. Read the relevant SKILL file if a procedure exists.
4. Read the client file (`clients/[slug].md`) when the task is client-specific.
5. Read the relevant code (e.g. `processor.ts`) when the task touches automated behaviour.
6. For reply or campaign work, read the full thread or campaign history before drafting a single word.

If context is missing or unclear, pause and ask. Do not guess.

---

## Where new learnings go (3-layer system)

When something is corrected or learned mid-session, save it immediately to the right file. Do not leave it in chat only.

| Layer | Goes here | Examples |
|---|---|---|
| Client | `clients/[slug].md` | Calendly link, calendar exceptions, offer details, FU templates, objection scripts |
| Context (cross-client rule) | `1. Departments/[dept]/CONTEXT_*.md` | Tone rules, formatting patterns, scenario library, "always X / never Y" |
| Skill (procedure) | `1. Departments/[dept]/SKILL_*.md` | Step-by-step recipes for tasks Claude runs in chat |
| Code | `app/api/...` or `lib/...` | Anything the processor or scheduled tasks rely on |
| Memory | `~/.claude/projects/.../memory/` | User identity, external references, in-flight project state — not rules |

Cross-client rules never live in memory. Memory is for things that survive across conversations but are not part of the repo's source of truth.

Use SKILL_FileRouter as the arbiter if unsure where a piece of content goes.

---

## Activity log

Every significant action gets appended to `1. Departments/operations/activity-log.md`, newest first. Log entries cover: replies sent, rules changed, prompts updated, decisions made, corrections received.

When Kasper or Lukas corrects something mid-session:
1. Fix it in the correct file (per the table above).
2. Add a one-line correction entry to the activity log for that date.

Corrections that are not logged get repeated. Logging is the paper trail.

---

## Skill vs context, when to delete one

- If a task is fully automated in code, the procedure lives in the code. The SKILL file is then redundant and should be deleted. Keep the CONTEXT file (the rule spec).
- If a task is run interactively (you ask Claude in chat), keep the SKILL file. CONTEXT is optional, only needed if the task has cross-cutting rules.

Reply-management has no SKILL file by design. The processor handles execution; `CONTEXT_Replies.md` is the rule spec.

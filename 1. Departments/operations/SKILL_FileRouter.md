# Skill: File Router — Enforce the 3-Layer System

## What this skill does
Audits any new content added to the workspace and routes each piece to the correct location: client file, context file, or operational skill file. Prevents knowledge base drift and keeps the system clean when new briefs, notes, or skill files are added.

---

## When to run this
- Someone has added a new skill file, doc, or block of notes to any department folder
- You've received a client brief, email thread, or Slack dump to process
- A new client is being onboarded and their context needs to be distributed
- You suspect a file contains mixed-layer content (e.g. a skill file with behavioral rules in it)
- Doing a periodic audit of the departments folder

---

## How to run
Ask Claude:
> "Route this content: [paste text or filename]"
> "I just added [filename] — is it in the right place?"
> "Audit the campaign folder for anything out of place"
> "We just onboarded a new client — here's their brief: [paste]"
> "This skill file has context mixed into it — clean it up"
> "Check all department folders for files that break the 3-layer system"

---

## The 3-Layer System

| Layer | What goes here | Where it lives |
|---|---|---|
| **Client files** | Anything specific to one client: offer, ICP, hooks, CTAs, what works/doesn't, calendar link, objection handling, deal context, FU templates, campaign history, key conversations | `clients/[slug].md` |
| **Context files** | Cross-client rules that inform HOW to work: tone rules, formatting rules, sequence structure, spam avoidance, objection handling patterns, language patterns, optimization strategies | `1. Departments/[dept]/CONTEXT_[Name].md` |
| **Skill files** | Step-by-step instructions for a specific runnable task: what the skill does, when to run it, how to invoke it, what Claude will output | `1. Departments/[dept]/SKILL_[Name].md` |

### Quick Classification Test
- Does it start with "always" or "never"? → **Context**
- Is it specific to one client only? → **Client file**
- Does it describe a step-by-step procedure with inputs and outputs? → **Skill file**
- Is it a rule that applies across multiple clients? → **Context**
- Is it a calendar link, CTA, hook, or objection script for one client? → **Client file**

---

## What Claude will do

1. Read the content to be routed (file path or pasted text)
2. Split it into discrete chunks — each rule, fact, template, or instruction is one chunk
3. For each chunk, classify it:
   - **Client-specific** → name the client and target file (`clients/[slug].md`, section to add it to)
   - **Cross-client rule or pattern** → name the department and target context file (`CONTEXT_[Name].md`)
   - **Operational procedure** → name the skill and target skill file (`SKILL_[Name].md`)
4. Flag any content that mixes layers (e.g. a skill file containing behavioral rules, or a context file with client-specific CTAs)
5. Output a routing decision table
6. On confirmation, execute the moves — write content to target files, remove from source

---

## Output format

Routing decisions for: [source file or description]

| Content chunk | Layer | Target file | Section | Action |
|---|---|---|---|---|
| "911 Restoration — always say phone call in CTA" | Client | clients/911-restoration.md | Campaign Strategy → CTA rules | Add |
| "No em dashes — ever" | Context | campaign/CONTEXT_Campaign.md | Formatting Rules | Already exists — skip |
| "Step 1 / Step 2 / Step 3 structure" | Context | campaign/CONTEXT_Campaign.md | Email Sequence Structure | Already exists — skip |
| "Run the campaign health check every Monday" | Skill | campaign/SKILL_LeadMonitoring.md | When to run this | Already captured — skip |
| "Svetlin Petrov, Calendly: [link]" | Client | clients/statera-capital.md | Quick Reference | Add |

Then:
> "Routing decisions above. Confirm and I'll execute all moves, or adjust any row before I do."

---

## Rules Claude must follow
- Never leave client-specific context in a shared context file
- Never put behavioral rules ("always do X", "never say Y") inside a skill file — those belong in context
- Never put step-by-step operational instructions inside a context file — those belong in a skill file
- A skill file should contain zero prose rules — only procedure (what, when, how, output)
- A context file should contain zero "how to run" instructions — only rules and patterns
- When routing client-specific content: check whether the target client file already has a matching section before adding
- When in doubt: if it reads like a policy, it's context. If it reads like a recipe, it's a skill. If it only applies to one client, it's a client file.

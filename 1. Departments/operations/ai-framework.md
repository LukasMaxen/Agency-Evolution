# AI Framework

Guidelines for building and expanding AI features across the Business OS.

---

## Models We Use

| Model | Use Case | Why |
|---|---|---|
| Claude Haiku (`claude-haiku-4-5-20251001`) | High-volume, real-time analysis (reply intent, draft replies) | Fast and cost-efficient |
| Claude Sonnet 4.6 | Complex reasoning, agent workflows, building new skills | More capable for nuanced tasks |

**Default rule:** Start with Haiku. Upgrade to Sonnet only if the task requires complex reasoning or multi-step logic.

---

## Caching Rules

- **Always cache AI results in the DB** — never call the API twice for the same input
- Reply analysis is cached in `replies.ai_analysis` (JSONB) — checked before every analysis call
- Any new AI feature should follow the same pattern: check cache → call API if empty → store result

---

## Building a New AI Feature

Follow the pattern established in `/api/analyze/route.ts`:

1. Create a server-side API route in `app/api/`
2. Check DB cache first — return cached result if exists
3. Call Anthropic API via direct fetch (not SDK) with `ANTHROPIC_API_KEY`
4. Store result in DB immediately
5. Return result to client
6. Use prompt caching (`cache_control`) wherever the system prompt is reused across requests

---

## Where AI Is Currently Active

| Feature | File | Model |
|---|---|---|
| Reply intent analysis | `app/api/analyze/route.ts` | Haiku |
| Suggested reply drafts | `app/api/analyze/route.ts` | Haiku |
| Building skills/agents | Claude Code (this tool) | Sonnet 4.6 |

---

## Expanding AI to New Departments

As we build out the Business OS, each department folder can have its own AI workflows. When adding AI to a new department:

1. Document the workflow in that department's folder
2. Build the API route in `app/api/`
3. Cache results in the DB
4. Update this file with the new feature

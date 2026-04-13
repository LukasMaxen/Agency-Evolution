# Agency Evolution — AI Usage & Guidelines

## Where AI Is Used

| Feature | Model | How |
|---|---|---|
| Reply intent analysis | Claude Haiku (`claude-haiku-4-5-20251001`) | `POST /api/analyze` — analyzes inbound lead replies |
| Suggested reply drafts | Claude Haiku | Returned as part of analysis response |
| Building skills/agents | Claude Sonnet 4.6 | Via Claude Code (this tool) |

---

## Reply Analysis — Output Schema

Every inbound reply is analyzed and cached in `replies.ai_analysis` (JSONB):

```json
{
  "intent": "interested_urgent | interested | needs_info | neutral | not_interested | unsubscribe",
  "urgency": "high | medium | low",
  "summary": "One-sentence summary of what the lead said",
  "suggestedTemplateId": "template ID from EmailBison or null",
  "suggestedReply": "Draft reply text"
}
```

**Caching rule:** Analysis is never re-run on a reply that already has `ai_analysis` populated.

---

## Intent Classification Rules

| Intent | When to use |
|---|---|
| `interested_urgent` | Lead gives a specific time/date, asks to book immediately, or shows strong urgency |
| `interested` | Lead expresses general interest, asks for more info, or responds positively |
| `needs_info` | Lead has questions before committing — needs more info to decide |
| `neutral` | Reply is ambiguous — could go either way |
| `not_interested` | Lead declines but is polite — deal isn't a fit |
| `unsubscribe` | Lead explicitly asks to be removed or stop contact |

---

## Reply Generation Rules

When drafting or improving AI-suggested replies:

1. **Match the client's tone** — formal vs. conversational is defined per client in `skills/AllClient_Skill.md`
2. **Keep it short** — 3–5 sentences unless the lead asked a specific question
3. **Use first name** — always personalize
4. **Include Calendly link** for interested leads — pull from client profile in SKILL.md
5. **Never hallucinate** deal terms, valuations, or offer details — only use what's in the client profile
6. **Intent shapes the reply type:**
   - `interested_urgent` → confirm + immediate Calendly link
   - `interested` → warm reply + Calendly link
   - `needs_info` → answer the question + soft CTA
   - `neutral` → light re-engagement
   - `not_interested` → graceful close, keep door open
   - `unsubscribe` → do not reply, just mark status

---

## AI Integration Architecture

- `lib/ai-analysis.ts` — client-side helper that calls `/api/analyze`
- `/api/analyze/route.ts` — server-side route that calls Anthropic API directly (not via SDK — raw fetch)
- Results cached immediately to DB to avoid re-analysis costs
- `AIBadge.tsx` — UI component rendering intent/urgency badges from analysis results

---

## Building New AI Features

When adding new AI capabilities to the dashboard:

- Default model: **Claude Haiku** for high-volume, real-time analysis (cost-efficient)
- Use **Claude Sonnet** for complex reasoning tasks (e.g., batch analysis, agent workflows)
- Always cache results in DB — never call the API twice for the same input
- Follow the pattern in `/api/analyze/route.ts` for new analysis endpoints
- Prompt caching should be used wherever the system prompt is reused across requests

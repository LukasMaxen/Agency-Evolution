# Campaign Management — Workflows

## The Lead Journey

```
Cold email sent → Lead replies → Reply lands in AI Reply Desk
→ AI analyzes intent/urgency → Operator reviews → Reply sent + Calendly link
→ Lead books call → Call tracked → Deal progresses
```

If no booking after initial reply → follow-up sequence (FU1–FU10, every 7 days)

---

## Reply Handling Workflow

1. **Lead replies** → EmailBison fires webhook → stored in `replies` table
2. **AI analyzes** reply via Claude Haiku → cached in `replies.ai_analysis`
3. **Operator reviews** in AI Reply Desk — sees intent, urgency, suggested reply
4. **Operator sends reply** (or edits and sends) → proxied to EmailBison via `/api/send-reply`
5. **Lead status updated** → `interested`, `not_interested`, or `unsubscribe`

---

## Follow-Up Sequence

- Triggered when lead is interested but hasn't booked a call
- 10 steps, spaced 7 days apart (unless client profile specifies otherwise)
- Tone progression:
  - FU1–3: Warm, informative, reference original interest
  - FU4–6: Shorter, more direct, mild urgency
  - FU7–9: Very short, low-pressure, keep door open
  - FU10: Final email — close the loop, leave on good terms
- Tracked in `follow_ups` table: `fu_step`, `next_fu_due`, `last_fu_sent_at`
- **Stop rules:** lead books a call, says remove me, or completes FU10

---

## Call Booking

- Two paths: **Calendly** (lead self-books via link in reply) or **Manual** (operator logs call)
- Calendly integration: single `CALENDLY_TOKEN`, fetches next 5 days, max 9 slots
- Calls stored in `calls` table with `source` (manual/calendly), `status`, `outcome`
- When call is booked: `meeting_booked = TRUE` on the reply, follow-up sequence stops

---

## Lead Status States

| Status | Meaning |
|---|---|
| `new` | Reply received, not yet reviewed |
| `interested` | Lead showed buying intent, follow-up active |
| `not_interested` | Lead declined or disqualified |
| `unsubscribe` | Lead asked to be removed — no further contact |
| `meeting_booked` | Call scheduled |

---

## Global Reply Rules (All Clients)

- Always use the lead's **first name**
- Keep replies to **3–5 sentences max** unless lead asked a specific question
- Never mention competitors
- Never make price/valuation promises (unless client profile says otherwise)
- Specific time/date from lead → treat as `interested_urgent`, confirm immediately + send Calendly link
- "Remove me" or "unsubscribe" → stop immediately, no exceptions

---

## Objection Handling Quick Reference

| Objection | Response |
|---|---|
| "Send me more info / a deck" | Send materials, follow up in 7 days if no response |
| "Not the right time" | Acknowledge, ask when to follow up, add to FU sequence |
| "Already working with someone" | Politely acknowledge, keep door open, don't push |
| "What's the deal structure?" | Answer per client offer in campaign-strategy/, offer a call for details |
| "Remove me" | Stop immediately, mark unsubscribe |

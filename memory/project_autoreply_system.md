---
name: Auto-reply system — fixes and architecture (2026-05-12)
description: Full picture of the auto-reply processor, every bug fixed, and the current state of the system after the May 12 incident
type: project
originSessionId: 3cf40cc3-320b-497c-9022-3c5d906e8d72
---
## What happened (2026-05-12)

A batch of ~26 replies fired at 17:23-17:24 on May 11 with bodies of just "Hi [Name]," and nothing else. All were interested leads. The processor sent them because:
- Claude returned a valid JSON where reply_body was only a greeting (LLM output issue, likely from too-low max_tokens under a heavy concurrent batch)
- There was no minimum body length check before sending
- The send path accepted any truthy reply_body value

All 26 affected leads were identified and manual replies drafted and sent to correct the error.

---

## Bugs fixed in this session

### auto-reply processor (app/api/auto-reply/processor.ts)

1. **Wrong recipient address** — was using `reply.to_email` (the sender's own inbox) as fallback. Fixed to always use `reply.lead_email`. Also fixed in `/api/send-reply/route.ts`.

2. **Inbound replies missing from thread history** — processor only pulled outgoing emails from `sent_emails`. Claude was drafting with half the conversation. Fixed: now merges outbound + inbound replies chronologically, labeled [US] and [LEAD].

3. **No minimum body length guard** — Claude could return "Hi [Name]," and it would send. Fixed: any reply_body under 80 chars after removing the signature placeholder is routed to manual instead of sending.

4. **No timeout on Claude API calls** — if Anthropic hung, the sweeper's `running` flag stayed locked indefinitely. Fixed: 90-second AbortController timeout on Sonnet calls, 30 seconds on Haiku.

5. **max_tokens too low (1500)** — tight for complex replies with long thread history. Raised to 2500.

6. **Strict JSON parse only** — a single stray character outside the JSON caused a hard fail. Fixed: tolerant fallback parser extracts outermost `{...}`.

7. **Alternate sender detection** — if a reply was written by someone other than the lead on record (forwarded internally, EA, colleague), Claude had no programmatic signal. Fixed: `detectAlternateSender()` scans the message for email addresses differing from `reply.lead_email`, injects a warning into the Claude prompt, and flags the recipient override visibly on the Slack approval card.

8. **Stale replies (>24h) silently dropped** — sweep excluded replies older than 24h with no alert. Fixed: sweep now detects these, marks them `errored`, and posts a Slack card to #manual-replies.

### follow-up processor (app/api/follow-ups/process/route.ts)

9. **Same timeout + max_tokens + JSON parse issues** — same fixes applied: 90s timeout, 2500 max_tokens, tolerant parser.

10. **No body length guard** — same truncation risk. Fixed: 80-char check before staging or auto-sending.

11. **Manual replies excluded from thread history** — FU processor only pulled `email_type IN ('follow_up', 'auto_reply')`. Manually sent replies were invisible to Claude. Fixed: now includes `email_type = 'reply'` and all inbound replies.

12. **Inbound replies after sequence started invisible** — if a lead replied to FU1 and the system missed it, FU2 went out ignoring the response. Fixed: FU processor now merges outbound + inbound messages chronologically.

### Slack events handler (app/api/slack/events/route.ts)

13. **No body length guard on regenerated drafts** — the pencil-reaction regenerate path had the same truncation risk. Fixed: 80-char check before saving regenerated reply or FU draft.

14. **FU sequence step count mismatch** — approval path created 5-step sequences, direct-send path created 6-step sequences. Leads got different treatment based on whether the quota was full that day. Fixed: both paths now create 6-step sequences.

### Self-sweeper (lib/auto-reply-self-sweeper.ts)

15. **Stale reply alert** — see #8 above.

### CONTEXT_Replies.md

16. **Documentation said 5-step FU sequence, code ran 6** — updated CONTEXT to say 6 steps.

---

## Auto-reply system architecture (current state)

**Trigger:** EmailBison webhook fires `POST /api/webhook/[workspace]` on LEAD_REPLIED. Reply stored in `replies` table with `status = 'new'`.

**Sweeper:** Runs every 60 seconds via `instrumentation.ts` in-process timer. Picks up all `status = 'new'` replies within last 24 hours, processes sequentially up to 20 per tick.

**6-minute hold:** Processor claims reply atomically (`UPDATE ... WHERE status = 'new' RETURNING *`). If <6 min since received, releases back to 'new'.

**Excluded workspaces:** `itg-group`, `sonaro-ai` skipped entirely. Workspaces with `forward_replies_to_email` use the forwarding path (no AI drafting).

**Context loaded:** client file + SKILL_Reply-Management.md + CONTEXT_Replies.md + SKILL_FollowUps.md + CONTEXT_FollowUps.md + full thread history (outbound + inbound, chronological).

**Alternate sender detection:** runs before Claude, injects warning if message contains an email address differing from `reply.lead_email`.

**Claude (Sonnet):** 90s timeout, 2500 max_tokens. Returns JSON with action/intent/fu_sequence_type/reply_body/recipient_email etc.

**Body guard:** reply_body stripped of signature must be >80 chars or routes to manual.

**Routing:**
- `do_nothing` → mark read
- `manual` → #manual-replies Slack card, status = 'awaiting_manual'
- `auto_send` (always-auto intents: unsubscribe/hard_no/wrong_target/hostile/not_interested) → send immediately
- `auto_send` (interested family) → approval gate: if within daily quota (50% of 7-day rolling avg, min 5), stage to reply_drafts + post to #reply-approval. Otherwise send directly.

**Approval card:** shows recipient override prominently with warning emoji if sending to a different address than the lead on record.

**FU sequence:** created after send. Full = 6 steps, abbreviated = 2 steps. FU processor runs every 5 minutes, drafts each step via Sonnet (with timeout + body guard), routes to approval if `fu_approval_mode` is on for workspace.

---

## Remaining known limitations

- **Haiku/template tier not implemented in auto-reply processor** — CONTEXT_Replies.md documents a two-tier flow where simple intents (unsubscribe, hard_no) use templates and only interested replies go to Sonnet. In practice everything goes to Sonnet. Works but templates would be more reliable for one-line confirmations.
- **Campaign type is inferred from correspondence** — no structured DB column for campaign type (sell_side_sourcing vs mandate_buyer vs sdr). Claude reads the full thread to determine this, which is reliable now that full thread history is included.

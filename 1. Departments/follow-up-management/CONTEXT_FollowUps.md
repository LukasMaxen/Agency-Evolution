# Follow-Up Management Context

The follow-up (FU) sequence is the automated re-engagement layer that runs **after** a lead has replied at least once and we have already sent our first response. If the lead does not reply back to our first response (and has not booked a call), the FU sequence kicks in.

## Where FUs Sit in the Pipeline

```
1. Cold email goes out (campaign sequence)
2. Lead replies                                  → handled by Reply Management
3. Auto-reply processor sends our FIRST RESPONSE → handled by Reply Management
4. Lead does not reply back / does not book      → FU sequence triggers
5. FU step 1 sends after 2 days                  → handled by Follow-Up Management
6. FU step 2 through 5 send on a 7-day cadence   → handled by Follow-Up Management
7. Lead books → sequence stops, outcome = booked
8. Lead replies mid-sequence → sequence stops, outcome = re_engaged, lead returns to Reply Management
9. Sequence reaches final step with no response → outcome = exhausted
```

Important: a FU is **never** the first message a lead receives from us about their reply. The first response is always handled by Reply Management. If you ever read an FU draft that sounds like a first response (acknowledging what the lead said for the first time, restating the offer, etc.), that is a bug.

## What Triggers an FU

A `follow_ups` row is created in the database **only when the auto-reply processor in Reply Management completes successfully** for a new inbound reply. The auto-reply processor classifies intent and writes:

- `fu_sequence_type` based on the lead's intent (see below)
- `next_fu_due = NOW() + 2 days`
- `fu_step = 0`
- `meeting_booked = false`

The cron-driven FU processor (`/api/follow-ups/process`) then picks up rows where `next_fu_due <= NOW()` and drafts the appropriate step.

Existing leads that replied before this system was deployed are paused (`next_fu_due = NULL`). Only leads who reply **from now forward** enter the FU sequence.

## Sequence Type Assignment (decided by Reply Management at first-response time)

| Lead intent (from auto-reply classification) | FU sequence type | Steps |
|---|---|---|
| `interested_urgent` | `full` | 5 |
| `interested` | `full` | 5 |
| `needs_info` | `full` | 5 |
| `neutral` | `full` | 5 |
| `not_interested` (with timing language: "not right now", "happy as is") | `abbreviated` | 2 |
| `unsubscribe` | `none` | 0 (no FU sequence) |
| Hard no (disqualified: "sold last year", "we never do this") | `none` | 0 |
| Meeting already booked in lead's reply | `none` | 0 |

Once Reply Management has classified and written this to `follow_ups`, the FU processor never re-classifies. It just drafts the right step at the right time.

## Step Purposes

### Full sequence (6 steps, alternating template and Sonnet)

The full sequence runs `template, Sonnet, template, Sonnet, template, Sonnet`. The templated steps are short check-ins. The Sonnet steps are personalised value adds. Total: 3 templates + 3 generated drafts per lead.

**Hard rule on CTAs (non-negotiable):**

| Step type | CTA allowed? | Why |
|---|---|---|
| Template (FU1, FU3, FU5) | NO | A template is a soft nudge that puts the ball back in the lead's court. The previous Sonnet email already had the offer and the Calendly link. The template's job is to surface whether the lead has engaged, not to re-pitch. |
| Sonnet (FU2, FU4, FU6) | YES | Each Sonnet step adds new value (case study, different angle, final hook) and ends with a clear CTA, usually two time slots + Calendly link. |

Templates must never include "worth a chat?", "available for 15 minutes?", calendar links, time slots, or any other booking ask. The acceptable shape of a template is:
- A soft check-in question ("Had a chance to look at my last email?")
- A binary intent question ("Should we move this forward or just leave it?")
- Or a single observation that nudges without asking

Anything that pushes for a meeting belongs in a Sonnet step, not a template.

**Cadence:** FU1 fires 2 days after our first response. FU2 to FU5 each fire 7 days after the previous step. FU6 fires 14 days after FU5. Total window from first reply: ~44 days.

**FU1, template `fu-nudge.md`** (2 days after first response)
Simple nudge in case the first email got buried. No new offer, no new angle. Just a low-friction check-in.

**FU2, Sonnet** (7 days after FU1) — *5 to 7 lines*
Value add #1. Reference a similar client outcome, a recent deal in the lead's sector, or specific market data. Different hook than the first response. End with the Calendly link and one open question that invites a one-line reply.

**FU3, template `fu-move-forward.md`** (7 days after FU2)
Binary intent check. Forces a yes/no without pressure. The cleanest way to surface dead leads.

**FU4, Sonnet** (7 days after FU3) — *5 to 7 lines*
Value add #2, different angle from FU2. New motivation or strategic consideration (succession, partial exit, market timing, owner liquidity, key-person risk, growth ceiling). Do NOT repeat any angle used in FU2 or earlier. End with a soft CTA.

**FU5, template `fu-check-in.md`** (7 days after FU4)
Direct check-in, the gold-standard "Should we move this forward or just leave it?" pattern. Single line, no padding.

**FU6, Sonnet** (14 days after FU5) — *strict 4-line structure*

This is the final email in the sequence. It must follow this exact shape, no exceptions:

```
Line 1: Hi {first_name},
Line 2-3: ONE specific value point. A recent comparable deal, a sector shift, a buyer activity update, or a market data point. Must be concrete (eg "a similar-sized acquisition closed in the UK last week with the founder retaining a stake"). Must NOT repeat any angle used in FU2 or FU4. Maximum 2 sentences, ~30 words.
Line 4: Soft close, no pressure. Examples: "If anything ever shifts at {company}, you have my contact." or "Otherwise we will be around when timing makes sense." Maximum 1 sentence, ~15 words.
Line 5: {SENDER_EMAIL_SIGNATURE}
```

Total target: 4 to 5 lines of body, under 50 words excluding the greeting and signature.

Wrong (too long, generic):
> Wanted to send one final note before stepping back. The space has been particularly active in the last few weeks, with several mid-market deals closing and buyers leaning back in. Our buyer has continued to look at businesses in this space, and what makes your company interesting is a combination of brand equity and operational efficiency. If anything ever changes for you, even just to know what comparable transactions are pricing at, you have my contact. Otherwise we will be around when timing makes sense.

Right (one specific value point + clean close):
> A craft brewing platform we work with closed a similar-sized acquisition in the UK last week, with the founder retaining a meaningful stake and staying on as a brand advisor. If that kind of structure is ever interesting at Wiper and True, you have my contact.
>
> Otherwise we will be around when timing shifts.

The structure forces brevity, prevents Claude from rambling, and gives the lead one concrete hook they can come back to even months later.

### Abbreviated sequence (2 steps, sent 2 days then 9 days after first response)

**FU1 — Soft re-engagement after no response** (3 to 4 lines)
The lead originally gave a soft no, we replied politely, they have not written back. Structure:
- Open with a brief follow-up framing. Example: "Following up on my last note. Wanted to send one more thing before stepping back." Do NOT say "Understood" or "Thanks for getting back to me", that was already covered in the first response.
- One value sentence OR one open-ended question, fresh angle. Examples: "If a quick read on what buyers are paying in your sector would be useful, happy to share what we are seeing." Or: "Curious whether timing typically opens up around year-end in your industry, or if it is more event-driven."
- Soft door-open close. Example: "Otherwise we will circle back later in the year. Reach out if anything shifts."

Maximum 4 lines of body. No specific time slots. No Calendly link. No clarification of the original offer. No restating what we do. No pushing for a meeting.

**FU2 — Break-up after no response to FU1** (2 to 3 lines)
Short, no-pressure final email. Reference that we have been in touch and are stepping back. Example: "Closing the loop on this for now. We will be around if timing ever shifts." Two to three lines maximum. No CTA, no calendar link.

## Wrong vs Right Examples

These read like a first response, not a follow-up. Do NOT write anything like these:

> "Hi Mike, understood and appreciated. If timing changes, happy to share what we are seeing."

> "Hi Mike, just to clarify this is not an investment ask. We represent a buyer who is actively looking..."

> "Just to clarify the context in case it was unclear, this was not about an investment opportunity for the company..."

These read like a re-engagement after no response. DO write things like these:

> "Hi Mike,
>
> Following up on my last note. Wanted to send one more thing before stepping back.
>
> If a quick read on what buyers are paying for businesses in your space would be useful, happy to share what we are seeing.
>
> Otherwise we will circle back later in the year. Reach out if anything shifts.
>
> {SENDER_EMAIL_SIGNATURE}"

> "Hi Sarah,
>
> Quick follow-up. We recently closed a sell-side mandate for a SaaS business in the same revenue range as yours. The structure surprised the founder in a good way.
>
> Worth 15 minutes to walk through what that looked like? Tuesday at 10am ET or Wednesday at 2pm ET both work, or grab a slot here: {CALENDLY_LINK}
>
> {SENDER_EMAIL_SIGNATURE}"

## Tone Rules (non-negotiable)

These are identical to Reply Management's rules and apply to every FU email:

- No em dashes, en dashes, or double-hyphens. The sanitizer in the FU processor strips these post-Claude as a safety net.
- No colons in the email body.
- No bullet points unless answering multiple specific questions.
- Banned filler phrases: "That's fantastic", "Sounds great!", "I'm excited", "I'd love to", "Thrilled", "Delighted", "Genuinely", "Straightforward".
- Match length to context. Shorter is better.
- Closings: "Looking forward to speaking with you." or "Looking forward to it." For break-ups: "Happy to revisit later."
- Never volunteer pricing or valuation numbers unless explicitly asked.
- For interested re-opens (full sequence FU1), include the client's Calendly link with exactly two suggested time slots.

## Critical Drafting Rules

1. **Never repeat angles across FU steps.** The processor passes all previously sent emails to Claude as context so each FU must take a fresh angle.
2. **Never restate or "clarify" the original offer in the FU body.** The lead already received a clear pitch in the cold email and a contextual first response. Treat them as informed.
3. **Never assume the lead is confused.** If they politely declined with timing language ("not right now"), they understand the offer and chose to pass. Respect that. The right move is a soft step-back, not a clarification.
4. **Read the lead's original reply at face value.** The first response handled their actual question or signal. The FU is for re-engagement, not re-pitching.
5. **Personalise to the lead's sector, company type, and any specific signals from their reply.** Generic FUs are weaker than specific ones.

## Approval Flow

Every workspace has a `fu_approval_mode` flag in the `workspaces` table, default `true`. While true:

1. The FU processor drafts the next step via Claude.
2. The draft is staged in the `follow_up_drafts` table with `status = 'pending'`.
3. A formatted card is posted to `#follow-up-approval` in Slack.
4. The team reviews and either approves (sends via EmailBison + advances the sequence) or rejects (skips, advances `next_fu_due` past).

When `fu_approval_mode` is set to `false` for a workspace, drafts auto-send via EmailBison without human review.

The default is approval-on for all workspaces. Turn it off per workspace only after at least 10 to 20 drafts have been reviewed and the output is consistently usable without edits.

## Outcome Tracking

Every `follow_ups` row eventually gets an `outcome`:

| Outcome | Meaning | Set when |
|---|---|---|
| `booked` | Lead booked a call | Calendly webhook fires (`invitee.created`) |
| `re_engaged` | Lead replied mid-sequence | Reply webhook detects active FU for this lead |
| `exhausted` | Reached final FU step with no response | FU processor completes the last step |
| `unsubscribed` | Lead asked to be removed | Reply Management classifies as unsubscribe |

`converted_at_step` records which FU step was the last one sent before the lead booked or re-engaged. This is the learning signal: review the conversion-step distribution monthly to identify which FU steps are pulling weight.

## What Reply Management Owns vs What Follow-Up Management Owns

| Responsibility | Owner |
|---|---|
| Classify lead intent | Reply Management (`processAutoReply`) |
| Send the first response | Reply Management |
| Decide `fu_sequence_type` | Reply Management |
| Create `follow_ups` row | Reply Management |
| Send FU step 1 through 5 | Follow-Up Management (`/api/follow-ups/process`) |
| Detect re-engagement and stop sequence | Webhook (`/api/webhook/[workspace]`) |
| Detect booking and stop sequence | Calendly webhook (`/api/webhook/calendly`) |
| Stage drafts for approval | Follow-Up Management |
| Track outcomes | Follow-Up Management |

If a draft seems wrong because the lead's intent was misclassified, that is a Reply Management problem. If a draft seems wrong because the wrong step purpose was applied, or the angle was repeated, or the tone was off, that is a Follow-Up Management problem.

# SKILL_FollowUps

Use this skill when drafting any follow-up email step, when reviewing FU drafts in `#follow-up-approval`, or when diagnosing why an FU draft came out wrong.

Always read `CONTEXT_FollowUps.md` first. It defines what an FU is, when it triggers, and how it differs from a first response.

## Inputs you need before drafting

| Input | Where to find it |
|---|---|
| Workspace slug | `follow_ups.workspace_slug` |
| Client GTM brief | `clients/[workspace_slug].md` |
| Lead's original reply | `replies.message` joined via `follow_ups.reply_id` |
| Lead's first-response we sent (if any) | `sent_emails` where `email_type = 'auto_reply'` and matching `reply_id` |
| Previously sent FUs in this sequence | `sent_emails` where `email_type = 'follow_up'` and matching `reply_id` |
| Sequence type | `follow_ups.fu_sequence_type` |
| Step to draft | `follow_ups.fu_step + 1` |
| Total emails in sequence | `follow_ups.total_emails` |
| Approval mode | `workspaces.fu_approval_mode` |

## Drafting procedure

1. **Read the original reply.** Identify the lead's actual signal: interested, neutral, soft no with timing, hard no, unsubscribe, booked. Do not re-classify, just understand the context Claude needs.
2. **Read the first response we sent.** This sets the baseline. The FU must move past what was already said. Do not re-acknowledge their reply, do not re-pitch the offer, do not repeat the calendar ask in the same words.
3. **Read every previously sent FU in the sequence.** Each FU must use a fresh angle. If FU2 used social proof, FU3 cannot.
4. **Pick the angle for this step** using the step purpose table in `CONTEXT_FollowUps.md`.
5. **Draft the email body** following the tone rules. Use plain text. Greeting on its own line, blank line, body paragraphs separated by blank lines, blank line, then `{SENDER_EMAIL_SIGNATURE}` on its own line.
6. **Verify before submitting:**
   - No em dashes or en dashes
   - No colons in the body
   - No banned filler phrases
   - The angle is genuinely new
   - The tone matches the lead's intent
   - Length matches the step purpose
   - For full FU Sonnet steps (FU2, FU4, FU6): Calendly link only. Never suggest specific time slots — no calendar access.
   - For abbreviated FU1: no time slots, no Calendly link, no clarification

## Common mistakes to avoid

- **Treating the FU like a first response.** The first response already happened. Do not start with "Thanks for getting back to me" or anything that implies you are reading their reply for the first time.
- **Clarifying the offer when the lead did not ask.** If the lead said "we aren't looking for investment opportunities right now", they understand the offer. Do not write "Just to clarify, this is not an investment ask." That is patronising and breaks trust.
- **Repeating the previous FU angle.** Always read prior emails first.
- **Pushing for a meeting in an abbreviated FU1.** The lead gave a soft no. The right move is a soft step-back, not specific time slots.
- **Volunteering a valuation range or pricing.** Never do this unless the lead specifically asked.
- **Writing long FUs.** Most FUs should be 4 to 7 lines. The break-up should be 2 to 3.

## When to send drafts directly vs stage for approval

The workspace's `fu_approval_mode` flag controls this automatically. Manual override is rare. If a draft is for a high-value lead in an unfamiliar context (new industry, unusual reply, complex objection), prefer staging for approval even if the workspace flag is off.

## Reviewing drafts in `#follow-up-approval`

When a draft lands in Slack:

1. Click the lead's name to open the original reply in the dashboard if needed.
2. Read the lead's original reply (top of the dashboard right panel).
3. Read what we already sent (in `sent_emails`).
4. Compare the draft against the criteria above.
5. Approve, edit, or reject.

Save corrections back into the GTM brief (`clients/[workspace_slug].md`) or into this skill if the correction reveals a pattern.

## When the FU draft is consistently wrong for a specific intent

If you find yourself rejecting many drafts of the same type (eg every soft-no FU1 keeps trying to clarify the offer), that is a prompt-engineering problem. Open `app/api/follow-ups/process/route.ts` and adjust the step purpose constants (`FULL_STEP_PURPOSES` and `ABBREVIATED_STEP_PURPOSES`). Add a few-shot example of the wrong output and the right output. Redeploy.

## Outcome review (monthly)

Query `follow_ups` once a month per workspace:

```sql
SELECT fu_sequence_type, outcome, converted_at_step, COUNT(*)
FROM follow_ups
WHERE workspace_slug = $1
  AND first_replied_at >= NOW() - INTERVAL '30 days'
GROUP BY fu_sequence_type, outcome, converted_at_step
ORDER BY fu_sequence_type, outcome;
```

Look for patterns:

- Which step pulled the most `re_engaged` outcomes? That step's angle is working. Lock it into the GTM brief.
- Which step had the most `booked` outcomes? That is the step that converts.
- Are abbreviated sequences ever converting? If not, consider dropping them entirely for that workspace.
- Are full sequences exhausting too often? Consider tightening the angle progression.

Feed all learnings back into the client's GTM brief or this skill so the next month is better than the last.

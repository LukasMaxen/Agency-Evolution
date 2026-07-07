# Activity Log

Running record of significant actions, decisions, and corrections. Append to the top (newest first).

---

## 2026-07-07

### Reply-approval backlog cleared (catch-up run)

Kasper was overwhelmed by the #reply-approval queue. Cleared all pending drafts received since Fri Jul 3, auto-sending the safe ones and holding the risky ones for manual review. Scope excluded GN Motion / Peter Gerasimov per standing rule.

- **29 pending drafts** in scope (acceler8rs 12, larsen-digital 13, act-capital 2, statera-capital 2). All were already `action=auto_send` drafts sitting in approval only because of the daily review quota.
- **25 sent** via EmailBison (replicated the Slack approve→send path: normalizeSignature, sent_emails insert, replies→replied, reply_drafts→sent, FU record with `next_fu_due=NULL` so no surprise follow-ups). `reviewed_by='kasper-catchup'`.
- **4 held** for manual review (left in awaiting_approval): Abdullah/Rightangled (leaning not-interested + "range of acquirers" framing violation), Deborah/Heaven Skincare (thread already ended, unprompted booking push), Luanne/Oro Sports (unsupported "you and Lukas are already connected" claim), Martin/Hole in the Wall (unverified phone number in draft).
- **3 content fixes before send**: Don/STAX and Jennifer/TruKid had fabricated time slots ("Tuesday 10am AEST", "Wednesday 11am PST") stripped to Calendly-only; Priscilla had an odd "best of luck with the call" line removed.

### Bug found: approval drafts store Slack-style links that break when sent

`reply_drafts.body` often stores links as `<https://url>` or `<https://url|label>` (Slack mrkdwn). The send path (`bodyToHtml` → `linkifyHtml`, regex `https?://[^\s<]+`) captures the trailing `>` / `|label` into the `href`, producing a dead Calendly/teaser link. ~15 of the 29 drafts were affected. Worked around this run by normalizing every URL to plain form before send (`<(url)(\|...)?>` → `url`). **This affects the normal Slack approve flow too and should be fixed at source** (strip brackets in the drafter, or fix `linkifyHtml` to drop a trailing `>`).

## 2026-05-05

### Reply system overhaul
- **Routing logic fixed**: Template replies (not_interested, hard_no, unsubscribe, wrong_target) now auto-send without Slack notification. Interested leads still go to #reply-approval for human approval.
- **Manual booking routing**: Leads who give a specific time window ("next week", "Monday", etc.) now correctly route to #manual-replies instead of reply-approval.
- **Bulk approval**: 29 replies from the 2026-05-05 Slack batch reviewed and sent.

### Corrections applied today

| Correction | Fixed in |
|---|---|
| Template replies were going to #reply-approval — should auto-send | `processor.ts` template path |
| Angry replies ("did you not read my last email") classified as neutral/manual instead of not_interested | Haiku prompt |
| Sonnet using `manual` action as escape hatch for difficult replies | Sonnet system prompt |
| Unused-account redirects (Italian OOO with new email) classified as neutral instead of forwarded | Haiku prompt |
| "A number of buyers" language in sell-side replies | Sonnet system prompt + CONTEXT_Replies.md |
| Leads giving time windows ("around next week") routed to reply-approval instead of manual-replies | Sonnet system prompt |
| Moses Shmueli reply mentioned $2,000/month price unprompted | Body override in bulk send |
| Jason (Venture Exits) draft used "buyers we work with" instead of specific buyer | Body override in bulk send |
| Abigail/Albert (Venture Exits) draft used generic "we work with businesses open to exploring" | Body override in bulk send |
| Brian Victor draft had [PHONE NUMBER] placeholder | Body override in bulk send |

### Rules updated
- `CONTEXT_Replies.md`: Added global specific-buyer-framing rule for all sell-side campaigns
- `CONTEXT_Replies.md`: Added template-check rule (template is floor, not ceiling)
- `processor.ts` Haiku prompt: forwarded vs OOO distinction (redirect email = always forwarded)
- `processor.ts` Haiku prompt: angry replies = not_interested/unsubscribe, never neutral
- `processor.ts` Sonnet prompt: manual = ONLY specific booking times/phone numbers
- `processor.ts` Sonnet prompt: hard rule on specific buyer framing

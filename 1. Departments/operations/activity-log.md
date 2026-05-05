# Activity Log

Running record of significant actions, decisions, and corrections. Append to the top (newest first).

---

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

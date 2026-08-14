# Activity Log

Running record of significant actions, decisions, and corrections. Append to the top (newest first).

---

## 2026-08-14

### Reply-approval sweep, two runs

Run 1: 2 gn-motion cards. Valerie/Smelly Cheese draft described her business back to her (subscription-model detail she never stated) — rewrote to drop it. Ebba/ICANIWILL replied "I'll keep this in mind for future projects" (a soft not-now) but the draft still carried the booking link — rewrote to a link-free gracious close per the "not now, usually no link" rule. Both sent clean.

Run 2: 1 act-capital card, Farah/Heritage Point Partners. Inbound was a Constant Contact mass-send (press-release style, `shared1.ccsend.com` sender) announcing HPoint's Mayatax acquisition, not an obviously personal reply. Intended to route it to manual review given the uncertainty, but wrote the `decisions.js` `manual` key as the *preferred* recipient address (`farah@heritagepoint.com`) instead of the `lead_email` key the sweep actually matches on (`farah-heritagepointpartners.com@shared1.ccsend.com`, per `pulled.json`) — the key didn't match, so the card fell through to "send as-is" and the original ACT Capital landscape-mandate pitch went out unreviewed.
- **On reread, the content itself was defensible**: the HPoint email explicitly said "Please reply to this email... to continue the conversation" and stated a real mandate ($1-8M EBITDA, property/industrial services) that the landscape teaser reasonably fits. So the send wasn't off-strategy, but it bypassed the manual check I'd decided it needed.
- **Fix going forward**: `decisions.js` keys for `rewrites`/`manual`/`skip` must always be the `lead_email` field from `pulled.json` / the `LEAD:` line in `view.cjs` output, never the `PREF->` address, even when they differ. Double-check the key against `pulled.json` before running `sweep.cjs` when the lead and preferred-recipient addresses diverge.

## 2026-08-13

### Larsen conversion investigation + live Calendly time proposals shipped

Kasper flagged the CSM update's Larsen numbers as suspicious (1 meeting booked against 33 EmailBison-reported interested replies). Investigation found the real cause: DB shows 105 Larsen replies stuck in `awaiting_manual`/`awaiting_approval` (63+18 larsen-digital, 20+4 acceler8rs), most over 7 days old, acceler8rs's queue untouched since May. Interested leads were being classified correctly but never actually getting a reply, so they went cold before booking.

- **Cleared what was reachable via the Slack-based sweep tools**: `manual-replies-sweep` (30-day Slack lookback) found 21 live cards, 11 Larsen. 2 auto-deleted (already-responded, meeting-scheduled). 3 confidently drafted and sent (diana@wasparfum.nl sourcing question, rbrisco@luckybevco.com closed-loop ack, alana@harpargrace.com/Erica Casey scheduling with live Calendly times). 6 left for Lukas (Pathfinder buyer-mandate judgment calls: fund verification, hemp-category stance, off-ICP/below-floor engagement decisions — none answerable without fabricating facts).
- **`reply-approval-sweep` pull only reaches 5 days back** — just 1 live card (Ziv/REATHLETE). Rewrote it: original draft both exceeded the 90-word limit and described the lead's category ("sports recovery products... repeat-purchase category") using researched details never stated in the thread, a hard rule violation. Attempted send was blocked by guard 3 (someone had already replied manually via EmailBison directly, outside DB tracking) — guard worked correctly.
- **KEY FINDING, unresolved:** the 105 DB-row backlog is mostly *not* reachable through either sweep tool's Slack lookback window (5-30 days). Most of it predates what these tools can see. This means the DB `awaiting_*` status is not a reliable live-queue indicator, some of it may already be resolved (as the Ziv guard-3 hit demonstrated) and some genuinely dead. **Next step: a DB-side reconciliation pass** (not Slack-based) to check each stale `awaiting_manual`/`awaiting_approval` row directly against EmailBison's live thread state and either close it out or re-surface it, so this can't silently regrow.
- **Shipped: live Calendly time proposals for Larsen**, reinstating (with real verification this time) the specific-time proposal capability disabled 2026-08-04 after a hallucination incident. New `calendly-verify.cjs` pulls real availability via the already-live per-client Calendly tokens; `sweep.cjs` and `send.cjs` guards now hard-block any day+time phrase in a draft unless every stated slot re-verifies live at send time (real, available, 8am-8pm in the lead's resolved timezone). Timezone resolution: explicit lead statement > company-location inference.
- **Bug found and fixed same session**: the guard's day+time detection regex (`"Tuesday at"` as a literal substring) missed real-world phrasing like "Tuesday 18 Aug at 5pm" (date text in between broke the match), so the alana@harpargrace.com send's verification step silently didn't run, even though the times used were genuinely live-verified by hand beforehand. Fixed the regex in both `sweep.cjs` and `send.cjs` to detect any day-name + clock-time combination independent of what's between them.

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

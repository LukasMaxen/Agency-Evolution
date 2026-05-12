---
name: Reply approval sampling — first 5 daily, then 50% of weekly average
description: First 5 eligible interested replies each day go to #reply-approval. The rest are auto-sent. Weekly average recalibrates the quota to 50%. Raised from 25% on 2026-05-11 due to reply quality concerns.
type: feedback
originSessionId: 5e943fa7-05e2-44d5-9321-84e862361d21
---
**Phase 1 — daily rule (active now):**
The first 5 eligible interested replies each day go to #reply-approval. All replies after that are auto-sent. Eligible = interested replies that are not already routed to #manual-replies.

**Phase 2 — weekly recalibration (ongoing):**
At the end of each week, calculate the average number of eligible interested replies per day across that week. 50% of that average becomes the new daily approval quota going forward. Example: 32 eligible replies/day average = 16 go to #reply-approval, rest auto-send.

**Key rules:**
- Eligible = interested replies not routed to #manual-replies (no phone call requests, no specific time windows for non-Larsen clients)
- The first N replies of the day (per the quota) go to approval — not cherry-picked
- Everything beyond the quota is auto-sent without review

Larsen Digital rule: ALWAYS send the Calendly link, even when the lead gives a specific day or time. Never send to #manual-replies for Larsen Digital. No exceptions.

**Why:** Quota raised from 25% to 50% on 2026-05-11 due to client feedback that auto-replies were not reflecting the actual correspondence (wrong context, repeated info, mismatched tone). System is paused until quality is confirmed.

**How to apply:** When processing eligible replies, count them. Route the first N (quota) to #reply-approval. Auto-send the rest. Recalculate N weekly using the 50% formula.

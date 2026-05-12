---
name: Lead monitoring — logic, format, and rules
description: Full rules for how lead monitoring works, what to flag, and how to format the Slack message
type: feedback
originSessionId: cd4d0b70-8ebd-481e-bcab-06edcf780651
---
## What to flag

A campaign needs new leads when:
- `step_0` (never_contacted) = 0
- AND in-sequence runway <= 3 days

Runway formula: `days_left = (in_seq * 1.5) / daily_cap`
- `in_seq` = leads with `lead_campaign_status = in_sequence`
- `daily_cap` = sum of `daily_limit` across active sender accounts on that campaign
- 1.5 multiplier = average remaining emails per in-sequence lead across steps 2 and 3

## What NOT to flag

- Campaigns with step_0 = 0 but runway > 3 days (DRAINING, still sending fine)
- Follow Up campaigns (skip entirely)
- Any campaign with "spam" in the name (skip entirely)
- No 3-week runway check ever

## Status indicators

- 🔴 = exhausted (in_seq = 0 or days_left = 0)
- 🟡 = 1-3 days remaining

## Slack message format

Channel: `C0B268H8Z2S`

```
📉 *Lead Supply: Action Required*
_N campaigns running out of leads within 3 days_

---

*Client Name*
🔴 Campaign name — _`X` leads in sequence, exhausted today_
🟡 Campaign name — _`X` leads in sequence, ~Nd remaining_

---

➡ _N campaigns checked across N workspaces_
```

If nothing flagged:
```
📭 *Lead Supply: All Clear*
_All N active campaigns have 3+ days of runway_

---

➡ _No lead uploads needed today_
```

## Formatting rules (from approved format)

- Bold header with emoji, no punctuation
- Italic one-line summary
- Divider (---) after header and before footer
- Group by client, sort by most urgent first
- Red circle for exhausted, yellow for 1-3 days
- Campaign name plain, leads in backtick code, timing in italic
- Closing arrow line with total count
- No em dashes, no sentences over 15 words, no filler

**Why:** Confirmed working format as of 2026-05-08. Kasper approved structure.

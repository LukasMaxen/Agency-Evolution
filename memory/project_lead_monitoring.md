---
name: Lead Monitoring routine
description: Daily lead supply check posted to Slack C0B268H8Z2S every weekday morning
type: project
originSessionId: 88fc6769-fd2a-4ffc-b1e8-cd01c055dcd7
---

**Slack channel:** C0B268H8Z2S
**Schedule:** 9am CET Mon-Fri
**Routine ID:** `trig_01M7HXMBPheK77Hrwe95S5Jv`

If auto-disabled: check GitHub app scope (must be "All repositories" in github.com/settings/installations).

---

## What it does

Checks every active EmailBison campaign across all 15 workspaces. Flags campaigns that will run out of leads within 3 days. Posts ONE Slack message.

## Flag logic

- Flag when: `step_0 = 0` AND `days_left <= 3`
- Runway: `days_left = (in_seq * 1.5) / daily_cap`
- `in_seq` = leads with `lead_campaign_status = in_sequence`
- `daily_cap` = sum of `daily_limit` across active senders on that campaign
- Skip: Follow Up campaigns, anything with "spam" in the name
- No 3-week runway check ever

## Status indicators

- 🔴 exhausted (in_seq = 0 or days_left = 0)
- 🟡 1-3 days remaining

## Slack format (approved 2026-05-08)

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

All clear format:
```
📭 *Lead Supply: All Clear*
_All N active campaigns have 3+ days of runway_

---

➡ _No lead uploads needed today_
```

## Workspaces (slug: display name)

| Slug | Display Name |
|---|---|
| 911-restoration | 911 Restoration |
| acceler8rs | Acceler8rs |
| act-capital | ACT Capital |
| gn-motion | GN Motion |
| hahnbeck | Hahnbeck |
| internal-campaigns | Agency Evolution CRM |
| itg-group | ITG Group |
| larsen-digital | Larsen Digital |
| micro-nordic | Micro Nordic |
| sonaro-ai | Sonaro AI |
| statera-capital | Statera Capital |
| venture-exits | Venture Exits |
| wrobel-capital | Wrobel Capital |
| zebs-ibs | Zebs IBS |
| zenith-global | Zenith Global |

## EmailBison API calls needed

- Campaigns: `GET /api/campaigns` → filter status active/running
- step_0: `GET /api/campaigns/{id}/leads?filters[lead_campaign_status]=never_contacted&per_page=1` → `meta.total`
- in_seq: `GET /api/campaigns/{id}/leads?filters[lead_campaign_status]=in_sequence&per_page=1` → `meta.total`
- daily_cap: `GET /api/campaigns/{id}/sender-emails` → sum `daily_limit` of active senders

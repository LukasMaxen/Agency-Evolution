# Skill: Lead Monitoring and Slack Alert System

## Platform
EmailBison. Each sender account sends 25 emails/day. Sending days are Monday-Friday only.

**Workspace daily capacity** = active sender accounts x 25.

---

## How EmailBison Sending Works

Each campaign runs a 3-step sequence:
- Step 1: sends immediately when lead enters campaign
- Step 2: sends 7 calendar days after Step 1
- Step 3: sends 7 calendar days after Step 2

All steps share the workspace sender capacity. Priority order: Step 1 > Step 2 > Step 3.

`step_0` = never_contacted leads (new leads waiting for Step 1). This is the only thing a new lead upload fixes.

**DRAINING** = step_0 is 0 but leads are still in-sequence (Steps 2/3 still sending). Campaign is healthy, do NOT flag.

**NEEDS LEADS** = step_0 = 0 AND in-sequence runway < 3 days. Flag immediately.

---

## EmailBison API Reference

| What | Endpoint | Key fields |
|---|---|---|
| List all campaigns | `GET {instanceUrl}/api/campaigns` | `id`, `name`, `status`, `max_new_leads_per_day`, `max_emails_per_day`, `completion_percentage` |
| Sender accounts for campaign | `GET {instanceUrl}/api/campaigns/{id}/sender-emails` | `daily_limit`, `status` |
| Lead count by stage | `GET {instanceUrl}/api/campaigns/{id}/leads?filters[lead_campaign_status]=never_contacted&per_page=1` | `meta.total` |
| In-sequence count | `GET {instanceUrl}/api/campaigns/{id}/leads?filters[lead_campaign_status]=in_sequence&per_page=1` | `meta.total` |

---

## Check Logic

For each active campaign (skip Follow Ups, skip anything with "spam" in the name):

1. Pull `step_0` = never_contacted lead count
2. Pull `in_seq` = in_sequence lead count
3. Pull `daily_cap` = sum of `daily_limit` across active sender accounts on that campaign
4. Calculate: `remaining_sends = in_seq * 1.5` (average ~1.5 emails remaining per in-sequence lead)
5. Calculate: `days_left = remaining_sends / daily_cap`
6. **Flag if: step_0 = 0 AND days_left <= 3**

---

## Output

Post ONE message to Slack channel `C0B268H8Z2S`.

- Only flagged campaigns (needs leads within 3 days)
- Group by client, sort by most urgent first (fewest days left)
- Show in-sequence count and days left
- Skip Follow Up campaigns entirely
- Skip any campaign with "spam" in the name

### Format

```
🔴 *Campaigns needing leads within 3 days* — May 8, 2026
7 of 28 campaigns flagged

*ACT CAPITAL*
• Tequila (Shared List) — `151` in sequence (~1d left)
• Northern Cali - Sell Side — `352` in sequence (~1d left)

_28 campaigns checked across 15 workspaces_
```

If nothing flagged: post 🟢 all clear message.

---

## Schedule

Run every day at **9:00 AM CET/CEST** Mon-Fri.

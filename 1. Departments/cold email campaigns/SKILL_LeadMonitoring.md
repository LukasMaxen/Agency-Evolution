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

Post ONE message to Slack channel `C0B268H8Z2S`. Routine ID: `trig_01M7HXMBPheK77Hrwe95S5Jv`.

- Only flagged campaigns (needs leads within 3 days)
- Group by client, sort by most urgent first (fewest days left)
- Status icons: 🔴 exhausted (in_seq = 0 or days_left = 0), 🟡 1-3 days remaining
- Skip Follow Up campaigns and any campaign with "spam" in the name
- No 3-week runway check ever

### Approved format (2026-05-08, confirmed by Kasper)

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

### All-clear format

```
📭 *Lead Supply: All Clear*
_All N active campaigns have 3+ days of runway_

---

➡ _No lead uploads needed today_
```

**Formatting rules:** bold header with emoji, italic one-line summary, `---` divider after header and before footer, campaign name plain, leads in backticks, timing in italic. No em dashes, no sentence over 15 words, no filler.

---

## Workspace display names

| Slug | Display name |
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

---

## Schedule

Run every day at **9:00 AM CET/CEST** Mon-Fri. If the routine auto-disables, check the GitHub app scope (must be "All repositories" in github.com/settings/installations).

# Skill: CSM Update

## What this skill does
Produces a performance report for all active client workspaces covering emails sent, replies, interested replies, and meetings booked. Works for any time window: daily (yesterday), weekly (last 7 days), monthly (last 30 days).

---

## Trigger phrases
- "Give me the CSM update"
- "CSM numbers for yesterday / last week / last month"
- "Daily update"
- "How did we do yesterday / this week?"
- Any request for send/reply/interested/meeting numbers across clients

---

## Data sources (non-negotiable)

| Metric | Source | Why |
|---|---|---|
| Emails sent | PostgreSQL DB (`emails_sent` table) | Webhook-populated, real-time |
| Replies | PostgreSQL DB (`replies` table) | Webhook-populated, real-time |
| Interested | PostgreSQL DB — AI intent classification only | EmailBison's interested flag is unreliable. Airtable inherits the same bug. Always use `ai_analysis->>'intent' IN ('interested','interested_urgent','needs_info')` OR `interested = true` as a fallback |
| Meetings | Airtable only (`Meeting Booked Date` field) | Source of truth. Never use `meeting_booked` from the DB — it is not reliably set |

---

## Queries

### Emails sent
```sql
SELECT workspace_slug,
  COUNT(*) FILTER (WHERE sent_at >= '{start}' AND sent_at < '{end}') AS sent
FROM emails_sent
WHERE sequence_step IS NOT NULL
GROUP BY workspace_slug
ORDER BY workspace_slug;
```

### Replies + Interested
```sql
SELECT workspace_slug,
  COUNT(DISTINCT lead_email) FILTER (WHERE received_at >= '{start}' AND received_at < '{end}') AS replies,
  COUNT(DISTINCT lead_email) FILTER (
    WHERE received_at >= '{start}' AND received_at < '{end}'
    AND (interested = true OR ai_analysis->>'intent' IN ('interested','interested_urgent','needs_info'))
  ) AS interested
FROM replies
GROUP BY workspace_slug
ORDER BY workspace_slug;
```

### Date windows
| Period | start | end |
|---|---|---|
| Yesterday (daily) | `YYYY-MM-11 00:00:00` | `YYYY-MM-12 00:00:00` |
| Last 7 days | `NOW() - INTERVAL '7 days'` | `NOW()` |
| Last 30 days | `NOW() - INTERVAL '30 days'` | `NOW()` |
| Monday weekly report | Last Monday 00:00 | Today 00:00 |

Use US Eastern time for all date calculations to match EmailBison's server timezone.

---

## Airtable meetings config

For each client, query the Meetings table with `IS_SAME({Meeting Booked Date}, 'YYYY-MM-DD', 'day')` for daily, or a date range for 7d/30d.

| Client | Base ID | Table ID | Field name |
|---|---|---|---|
| 911 Restoration | appGTy1rR6eZjKu62 | tblVEhq27whUNk4KY | Meeting booked date |
| ACT Capital | appECObQrdSRjeXeM | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Acceler8rs | appV8wpBdqTgCi4Ws | tblCATnaPTV9fb2Ab | Meeting booked date |
| GN Motion | appL5fZEyULdqpyx5 | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Hahnbeck | appUZr45I0MK7uv3w | tbl9KatGYqPFB45Hs | Meeting booked date |
| Internal Campaigns | app9rWZ2iE4eWECEN | tblCATnaPTV9fb2Ab | Meeting booked date |
| ITG Group | appajhv22WuCEw7Aa | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Larsen Digital | appmixoDAnp7FicCS | tblB3gNeQNs29SMgO | Meeting booked date |
| Micro Nordic | appBH1m8XsGoRmSPZ | tblVEhq27whUNk4KY | Meeting booked date |
| Sonaro AI | appNMGCTwXVOLLzmA | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Statera Capital | app0EI3nqT3ScUJOf | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Venture Exits | appA3W783M4v9IShx | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Wrobel Capital | appFvPc98WyrPibkV | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Zebs IBS | appdpPuzEjTqFSOi2 | tblTnxArHDVMNOxSI | Meeting Booked Date |

---

## Output format

Use this exact per-client block (confirmed 2026-05-14):

```
[Client Name]:
Emails Sent: X,XXX
Total Replies: XX
Reply Rate: X,XX%
Interested Replies: X - XX,XX%
Meetings Booked: X - XX,XX%

Observation:
________________________________________
```

Totals block:

```
Total Numbers Yesterday:

Emails Sent: XX,XXX
Total Replies: XXX
Reply Rate %: X,XX%
Positive Replies: XX
Positive Reply Rate %: XX,XX%
Meetings: X
Meeting Conversion %: XX,XX%

Efficiency
Emails to get a Lead: X,XXX
Emails to get a Meeting: X,XXX
```

Rules:
- Thousands separator: comma (3,000). Decimal separator: comma (1,03%).
- Meetings % = meetings / interested. TBD% when interested = 0. 0,00% when interested > 0 but meetings = 0.
- "Emails to get a Lead" and "Emails to get a Meeting" belong ONLY in the totals block, never in per-client blocks.
- Positive Reply Rate = interested / replies. Meeting Conversion = meetings / interested.
- Efficiency: Emails to get a Lead = sent / interested, Emails to get a Meeting = sent / meetings.
- Micro Nordic: Emails Sent = N/A. Internal Campaigns: use actual sent count from DB.
- Always do full manual review of all replies before reporting interested counts.

---

## Known issues / flags

- **DB `meeting_booked` flag**: never use — unreliable. Airtable only.
- **DB `interested` boolean**: unreliable — always use AI intent classification instead.
- **Internal Campaigns**: emails sent ARE tracked in DB (sequence_step = 1). Include the actual sent count. Previous note saying N/A was outdated.

---

## Script
The full automated version lives at `scripts/csm_update.py`. Run with:
```bash
python3 scripts/csm_update.py
```
Requires Google Sheets OAuth credentials at `~/.config/gspread/credentials.json` to write to the sheet.

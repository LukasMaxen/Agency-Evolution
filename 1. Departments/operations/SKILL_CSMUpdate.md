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
| Emails sent | EmailBison API (`/api/workspaces/v1.1/stats`) | Source of truth. Matches the EmailBison UI exactly. Counts initial sends AND follow-ups, no `sequence_step` filter. |
| Replies | EmailBison API (`/api/workspaces/v1.1/stats`) — field `unique_replies_per_contact` | Same call as emails sent, returned in the same response. |
| Interested | EmailBison API (`/api/workspaces/v1.1/stats`) — field `interested` | Same call. EmailBison runs its own AI categorization and is treated as authoritative. Our DB's AI intent classification feeds back into EmailBison via a sync (see "Back-sync" section) so EmailBison stays correct. |
| Meetings | Airtable only (`Meeting Booked Date` field) | Source of truth. Never use `meeting_booked` from the DB — it is not reliably set. |

---

## EmailBison stats endpoint

For each workspace, make one API call:

```
GET {instance_url}/api/workspaces/v1.1/stats?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
Authorization: Bearer {email_bison_api_key}
```

Pull `instance_url` and `email_bison_api_key` per workspace from the `workspaces` table:

```sql
SELECT slug, name, email_bison_instance_url, email_bison_api_key FROM workspaces;
```

The response shape:

```json
{
  "data": {
    "emails_sent": 1930,
    "unique_replies_per_contact": 11,
    "interested": 3,
    "bounced": 32,
    "unsubscribed": 0,
    ...
  }
}
```

Map to the report fields:
- `Emails Sent` → `data.emails_sent`
- `Total Replies` → `data.unique_replies_per_contact`
- `Interested Replies` → `data.interested`

### Date windows
| Period | start_date | end_date |
|---|---|---|
| Yesterday (daily) | `YYYY-MM-DD` (yesterday) | `YYYY-MM-DD` (yesterday) |
| Last 7 days | yesterday minus 6 days | yesterday |
| Last 30 days | yesterday minus 29 days | yesterday |
| Monday weekly report | last Monday | last Friday |

EmailBison interprets `start_date` and `end_date` as inclusive day-bounded ranges (workspace local time). For "today so far" partial-day pulls, pass today's date as both start and end.

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

## Delivery (non-negotiable)

Never post the CSM update to Slack automatically. Always output the fully formatted update in chat so Lukas can edit and copy-paste it into Slack himself. Do not call `slack_post_message` unless he explicitly asks you to post it for him.

Slack channel used by Lukas: `C092ZPT3T2P`. Schedule: 8am CET/CEST Mon-Fri.

**Monday switch:** on Mondays the report covers the full previous week (Mon-Fri). Tue-Fri stays as a single-day report for yesterday only.

---

## Agency Evolution CRM — three names, never get this wrong

The internal workspace has three different names across systems. Always display as "Agency Evolution CRM" in the report.

| System | Name |
|---|---|
| DB slug | `internal-campaigns` |
| EmailBison workspace | "Internal campaigns" |
| Airtable base | "Agency Evolution CRM" |
| Report label | "Agency Evolution CRM" |

- Always include this client in every report, even if sends = 0.
- Pulled from the same EmailBison stats endpoint as every other workspace (no DB-specific handling needed).

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
- Micro Nordic: Emails Sent = N/A.

---

## Back-sync (DB AI intent → EmailBison interested flag)

EmailBison is the single source of truth for the `interested` count in the CSM update. To keep EmailBison accurate, our reply-management pipeline runs a back-sync: whenever our DB classifies a reply as interested (`ai_analysis->>'intent' IN ('interested','interested_urgent','needs_info')`) and the corresponding EmailBison reply is NOT already flagged interested, we mark it interested via the EmailBison API.

This means the skill never has to do manual reply review. EmailBison's number is trusted as-is.

---

## Known issues / flags

- **DB `meeting_booked` flag**: never use — unreliable. Airtable only.
- **Wrobel Capital**: sometimes shows 0 sent but has replies — delayed replies from prior days' sends. Normal.
- **Hahnbeck**: receives a lot of inbound cold emails and marketing newsletters. If EmailBison's `interested` count looks unusually high, spot-check the replies tab before reporting.


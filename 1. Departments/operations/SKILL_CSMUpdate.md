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

## Credentials and where they live

| What | Where | How to get it |
|---|---|---|
| Postgres connection | `DATABASE_URL` in `.env.local` | Already set for the project. If missing, see `.env.local.example` and ask Lukas. |
| Airtable token | `AIRTABLE_API_KEY` in `.env.local` | Required for the meetings query. Read-only PAT, shared across the team. |
| EmailBison API key per workspace | DB table `workspaces.email_bison_api_key` | Each client workspace has its own key. Pull at query time. |
| EmailBison instance URL per workspace | DB table `workspaces.email_bison_instance_url` | Most workspaces share `https://send.emailagencyevolution.com`, but AH Consulting and WithPebble run on a separate EmailBison account at `https://send.shieldsoutbound.com`. Always read from DB per workspace, never hardcode the instance URL. |

Fetch all workspace creds at the start of the run:

```sql
SELECT slug, name, email_bison_instance_url, email_bison_api_key FROM workspaces ORDER BY slug;
```

---

## EmailBison stats endpoint

For each workspace, make one API call:

```
GET {instance_url}/api/workspaces/v1.1/stats?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
Authorization: Bearer {email_bison_api_key}
```

Working curl example (replace token + dates):

```bash
curl -s -G "https://send.emailagencyevolution.com/api/workspaces/v1.1/stats" \
  -H "Authorization: Bearer $EMAIL_BISON_API_KEY" \
  --data-urlencode "start_date=2026-05-13" \
  --data-urlencode "end_date=2026-05-13"
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

For each client, query their Meetings table filtered on **"Meeting booked date"** (when the meeting was scheduled), NOT "Date Of Meeting" (when it takes place). Each Meetings table has both fields — always use the booking date field.

Working curl example (replace base + table + date):

```bash
curl -s -G "https://api.airtable.com/v0/{BASE_ID}/{TABLE_ID}" \
  -H "Authorization: Bearer $AIRTABLE_API_KEY" \
  --data-urlencode "filterByFormula=IS_SAME({Meeting Booked Date}, '2026-05-13', 'day')" \
  --data-urlencode "fields[]=Meeting Booked Date"
```

The count of meetings is `len(response.data.records)`. Note the field name varies by base — see the table below for the exact casing.


| Client | Base ID | Table ID | Field name |
|---|---|---|---|
| 911 Restoration | appGTy1rR6eZjKu62 | tblVEhq27whUNk4KY | Meeting booked date |
| AH Consulting (Austin Heaton) | appZhEsVN52VXPZ66 | tblTnxArHDVMNOxSI | Meeting booked date |
| ACT Capital | appECObQrdSRjeXeM | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Larsen Digital - Lukas | appp8h0kv9DEHYpXR | tblkoizZek5r5wi45 | Meeting booked date | Moved 2026-08-31 to base in "Larsen Digital 2" workspace (old base appV8wpBdqTgCi4Ws hit its workspace's Airtable plan limit, see project_airtable_billing_limit_2026_08_31 memory). MUST filter `Deal Source = 'Lukas'`. This "Deals / Meetings" table is shared with Larsen Digital - Nicklas, whose meetings are tagged `Nicklas`. Counting all records over-attributes them to the wrong sender. (DB slug still `acceler8rs` — see Larsen rename note below.) |
| GN Motion | appL5fZEyULdqpyx5 | tblTnxArHDVMNOxSI | Meeting Booked Date | |
| Hahnbeck | appUZr45I0MK7uv3w | tbl9KatGYqPFB45Hs | Meeting booked date | |
| Internal Campaigns | app9rWZ2iE4eWECEN | tblCATnaPTV9fb2Ab | Meeting booked date | |
| ITG Group | appajhv22WuCEw7Aa | tblTnxArHDVMNOxSI | Meeting Booked Date | |
| Larsen Digital - Nicklas | appp8h0kv9DEHYpXR | tblkoizZek5r5wi45 | Meeting booked date | Moved 2026-08-31 to base in "Larsen Digital 2" workspace (old base appV8wpBdqTgCi4Ws hit its workspace's Airtable plan limit). MUST filter `Deal Source = 'Nicklas'`. Shared base with Larsen Digital - Lukas (see above). As of 2026-08-05 this is the SAME base/table as Lukas — the two are distinguished only by Deal Source, not by base. (DB slug `larsen-digital`.) |
| Sonaro AI | appNMGCTwXVOLLzmA | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Statera Capital | app0EI3nqT3ScUJOf | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Venture Exits | appA3W783M4v9IShx | tblTnxArHDVMNOxSI | Meeting Booked Date |
| Wrobel Capital | appFvPc98WyrPibkV | tblTnxArHDVMNOxSI | Meeting Booked Date |
| WithPebble | appjEe12UdVsRX10y | tblTnxArHDVMNOxSI | Meeting booked date |
| Zebs IBS | appdpPuzEjTqFSOi2 | tblTnxArHDVMNOxSI | Meeting Booked Date |

---

## Delivery (non-negotiable)

Never post the CSM update to Slack automatically. Always output the fully formatted update in chat so Lukas can edit and copy-paste it into Slack himself. Do not call `slack_post_message` unless he explicitly asks you to post it for him.

Slack channel used by Lukas: `C092ZPT3T2P`. Schedule: 8am CET/CEST Mon-Fri.

**Monday switch:** on Mondays the report covers the full previous week (Mon-Fri). Tue-Fri stays as a single-day report for yesterday only.

---

## Internal Campaigns — three names, never get this wrong

The internal workspace has three different names across systems. Always display as "Internal Campaigns" in the report.

| System | Name |
|---|---|
| DB slug | `internal-campaigns` |
| EmailBison workspace | "Internal campaigns" |
| Airtable base | "Agency Evolution CRM" |
| Report label | "Internal Campaigns" |

- Always include this client in every report, even if sends = 0.
- Pulled from the same EmailBison stats endpoint as every other workspace (no DB-specific handling needed).

---

## Larsen Digital — two sender workspaces, always report separately

As of 2026-08-05, "Acceler8rs" is retired as a separate brand. Larsen Digital now sends from two EmailBison sender workspaces, both pitching identical offers (growth/operating-partner AND Pathfinder buy-side), differing only by which person sends:

| DB slug | `workspaces.name` | Report label | Sender |
|---|---|---|---|
| `larsen-digital` | Larsen Digital - Nicklas | Larsen Digital - Nicklas | Nicklas Larsen |
| `acceler8rs` | Larsen Digital - Lukas | Larsen Digital - Lukas | Lukas Maxen |

- DB slugs were kept as-is (`larsen-digital` / `acceler8rs`) to avoid breaking the live EmailBison and Calendly webhook registrations — only the display name changed. Always pull the report label from `workspaces.name`, never hardcode "Acceler8rs" or "Larsen Digital" alone.
- Always report the two as separate line items, same as any other two clients — never merge their numbers.
- Emails sent / replies / interested: same per-workspace EmailBison stats call as every other client, no special handling.
- Meetings: same shared Airtable base for both (see the Airtable meetings config table above), split by Deal Source, not by base.

---

## AH Consulting / Internal Campaigns — Austin-themed campaigns split across two workspaces

Lukas runs "AustinHeaton"-branded campaigns (seen as `AE Version - AustinHeaton | AI Companies`, `AEO Version - AustinHeaton | AI Companies`, and `AE Version - AustinHeaton | AI Companies (our leads)`) through the **Internal Campaigns** EmailBison workspace, not through AH Consulting's own workspace. Any lead from one of these who books a meeting shows up correctly in `calls`/Airtable under `internal-campaigns` — that part isn't a bug — but it means a meeting that is conceptually "for Austin" gets counted in the Internal Campaigns line item instead of the AH Consulting line item, splitting the true Austin meeting count across both.

Report each client's real Airtable/EmailBison numbers as-is, with no cross-check query. The generated `Note:` line stays blank for both clients regardless of this split — do not auto-fill it with a note about the split. Kasper can add that context manually if he wants it for a given report.

---

## Excluded clients (never include in reports)

The following workspaces exist in the DB but are excluded from every CSM update:

- **Micro Nordic** (slug: `micro-nordic`)
- **SRO Consulting** (slug: `sro-consulting`)
- **Zenith Global** (slug: `zenith-global`)
- **Venture Exits** (slug: `venture-exits`)
- **Zebs IBS** (slug: `zebs-ibs`)
- **Wrobel Capital** (slug: `wrobel-capital`)
- **ITG Group** (slug: `itg-group`)
- **911 Restoration** (slug: `911-restoration`)

---

## Output format

Use this exact per-client block (updated 2026-09-04: every client block ends with a blank `Note:` line for Kasper to fill in manually. Never pre-fill it with a generated observation, e.g. the Austin/Internal Campaigns split, high-Hahnbeck-interested flag, etc. Leave it empty as `Note:` with nothing after the colon):

```
[Client Name]:
Emails Sent: X,XXX
Total Replies: XX
Reply Rate: X,XX%
Interested Replies: X - XX,XX%
Meetings Booked: X - XX,XX%
Note:
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
- Micro Nordic is excluded from all reports. Do not include it.

---

## Step-by-step recipe (run this end to end)

When asked for a CSM update, do this in order:

1. **Resolve the date window.** Default for a daily request is yesterday. If the user says "today", "last 7 days", or "last 30 days", use that. Use UTC dates as `YYYY-MM-DD` strings.
2. **Load workspace creds.** Run the SQL above against the `workspaces` table to get every client's `slug`, `email_bison_instance_url`, and `email_bison_api_key`.
3. **For each workspace, fetch the stats.** Call `/api/workspaces/v1.1/stats` with the date window. Extract `emails_sent`, `unique_replies_per_contact`, `interested`.
4. **For each workspace, fetch meetings.** Call Airtable with that client's base ID, table ID, and field name (from the Airtable meetings config table). Count the records.
5. **Format each per-client block** using the exact template under "Output format". Use comma as decimal separator. TBD% when interested = 0. End every block with a blank `Note:` line (nothing after the colon) for Kasper to fill in manually — never generate the note content yourself.
6. **Compute the totals block** by summing across all clients. Skip Micro Nordic's emails sent (N/A) from the totals.
7. **Output everything in chat.** Do NOT post to Slack automatically.

---

## Back-sync (DB AI intent → EmailBison interested flag)

EmailBison is the single source of truth for the `interested` count in the CSM update. To keep EmailBison accurate, our reply-management pipeline runs a back-sync: whenever our DB classifies a reply as interested (`ai_analysis->>'intent' IN ('interested','interested_urgent','needs_info')`) and the corresponding EmailBison reply is NOT already flagged interested, we mark it interested via the EmailBison API.

This means the skill never has to do manual reply review. EmailBison's number is trusted as-is.

---

## Known issues / flags

- **DB `meeting_booked` flag**: never use — unreliable. Airtable only.
- **Wrobel Capital**: sometimes shows 0 sent but has replies — delayed replies from prior days' sends. Normal.
- **Hahnbeck**: receives a lot of inbound cold emails and marketing newsletters. If EmailBison's `interested` count looks unusually high, spot-check the replies tab before reporting.


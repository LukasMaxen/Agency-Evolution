---
name: CSM update process
description: Exact data sources and method to use for every CSM update request (daily, weekly, monthly)
type: feedback
originSessionId: 802f82a0-8470-4636-a178-029bdab800f1
---
Always follow SKILL_CSMUpdate.md for any CSM update request. Never deviate from these sources:

- Emails sent: PostgreSQL DB (`emails_sent` table, `sequence_step IS NOT NULL`)
- Replies: PostgreSQL DB (`replies` table, COUNT DISTINCT lead_email)
- Interested: PostgreSQL DB using AI intent (`ai_analysis->>'intent' IN ('interested','interested_urgent','needs_info')` OR `interested = true`) — never use EmailBison's interested flag or Airtable for this
- Meetings: Airtable only (`Meeting Booked Date` field per client) — never use DB `meeting_booked`

**Why:** EmailBison's interested flag is unreliable. Airtable inherits that bug for interested tracking. DB `meeting_booked` is also unreliable. Airtable meetings are accurate. AI intent in the DB is the most accurate interested signal.

**How to apply:** Any time the user asks for numbers, a daily/weekly/monthly update, or "how did we do" — read SKILL_CSMUpdate.md and follow it exactly.

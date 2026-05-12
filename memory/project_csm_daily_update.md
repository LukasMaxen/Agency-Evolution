---
name: CSM Daily Update routine
description: Config and rules for the daily CSM numbers update posted to Slack
type: project
originSessionId: cd4d0b70-8ebd-481e-bcab-06edcf780651
---
Run via: `python3 scripts/csm_daily_update.py` from repo root.

**Monday logic:** On Mondays the script automatically switches to a full last-week report (Mon-Fri previous week) for sends, replies, interested, and Airtable meetings. Tue-Fri stays as single-day report.

**Slack channel:** C092ZPT3T2P
**Schedule:** 8am CET/CEST Mon-Fri (cron: `0 6 * * 1-5`). Accepts 1-hour DST shift. Routine ID: `trig_01EJ4pvDe9xiGPZNMCP4KnvX`

---

## Agency Evolution CRM — NEVER GET THIS WRONG

This one workspace has three different names. Always display as "Agency Evolution CRM":

| System | Name |
|---|---|
| DB slug | `internal-campaigns` |
| EmailBison workspace | "Internal campaigns" |
| Airtable base | "Agency Evolution CRM" |
| All reports | "Agency Evolution CRM" |

- Webhook URL: `http://j421lqyprj99ndrt84cjjeg8.77.42.71.101.sslip.io/api/webhook/internal-campaigns`
- EmailBison API token name: "Claude"
- Airtable: base `app9rWZ2iE4eWECEN`, table `tblCATnaPTV9fb2Ab`, field `Meeting booked date`
- ALWAYS include in every report. No exceptions. Even if sends = 0 in DB.
- Replies and interested ARE tracked in DB under slug `internal-campaigns`.
- EMAIL_SENT webhook was missing until 2026-05-08 when it was manually created with all 8 events. Sends will be in DB from 2026-05-08 onwards.

---

## Data sources

- **Sends:** `emails_sent` table, `sequence_step IS NOT NULL`, date range yesterday UTC
- **Replies:** `COUNT(DISTINCT lead_email)` from `replies` table, date range yesterday UTC
- **Interested:** `COUNT(DISTINCT lead_email) FILTER (WHERE interested = true)`
- **Meetings:** Airtable per-client bases, field `IS_SAME({field}, 'YYYY-MM-DD', 'day')`
- **AIRTABLE_API_KEY:** loaded from `.env.local` automatically by script if not in shell env

## Always-include workspaces (even with 0 sends)

The script includes all slugs in the NAMES dict, not just those in `emails_sent`. This ensures Agency Evolution CRM and any other workspace with reply/meeting data always appears.

## Airtable meeting config

| Slug | Base | Table | Field |
|---|---|---|---|
| 911-restoration | appGTy1rR6eZjKu62 | tblVEhq27whUNk4KY | Meeting booked date |
| acceler8rs | appV8wpBdqTgCi4Ws | tblCATnaPTV9fb2Ab | Meeting booked date |
| act-capital | appECObQrdSRjeXeM | tblTnxArHDVMNOxSI | Meeting Booked Date |
| gn-motion | appL5fZEyULdqpyx5 | tblTnxArHDVMNOxSI | Meeting Booked Date |
| hahnbeck | appUZr45I0MK7uv3w | tbl9KatGYqPFB45Hs | Meeting booked date |
| internal-campaigns | app9rWZ2iE4eWECEN | tblCATnaPTV9fb2Ab | Meeting booked date |
| itg-group | appajhv22WuCEw7Aa | tblTnxArHDVMNOxSI | Meeting Booked Date |
| larsen-digital | appmixoDAnp7FicCS | tblB3gNeQNs29SMgO | Meeting booked date |
| sonaro-ai | appNMGCTwXVOLLzmA | tblTnxArHDVMNOxSI | Meeting Booked Date |
| statera-capital | app0EI3nqT3ScUJOf | tblTnxArHDVMNOxSI | Meeting Booked Date |
| venture-exits | appA3W783M4v9IShx | tblTnxArHDVMNOxSI | Meeting Booked Date |
| wrobel-capital | appFvPc98WyrPibkV | tblTnxArHDVMNOxSI | Meeting Booked Date |
| zebs-ibs | appdpPuzEjTqFSOi2 | tblTnxArHDVMNOxSI | Meeting Booked Date |

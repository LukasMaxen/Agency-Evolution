# Skill: Lead Monitoring and Slack Alert System

## Platform
EmailBison. Each sender account sends 25 emails/day. Sending days are Monday-Friday only (5 days/week). All volume and runway calculations use 5 sending days, not 7.

**Workspace max daily capacity** = sender accounts x 25.

---

## EmailBison API Reference

All calls use workspace credentials from DB (`email_bison_api_key`, `email_bison_instance_url`).

| What | Endpoint | Key fields |
|---|---|---|
| List all campaigns | `GET {instanceUrl}/api/campaigns` | `id`, `name`, `status`, `total_leads`, `total_leads_contacted`, `max_new_leads_per_day`, `max_emails_per_day` |
| Single campaign | `GET {instanceUrl}/api/campaigns/{id}` | same as above |
| Sender accounts for a campaign | `GET {instanceUrl}/api/campaigns/{id}/sender-emails` | `id`, `email`, `status`, `daily_limit` |
| All sender accounts | `GET {instanceUrl}/api/sender-emails` | `id`, `email`, `status`, `daily_limit` |
| Scheduled emails (all) | `GET {instanceUrl}/api/scheduled-emails` | `campaign_id`, `scheduled_date`, `status` — paginated, 84k+ records, no working date filter |

**Note on date filtering:** The `/api/scheduled-emails` endpoint does not support date filtering. Use remaining leads (`total_leads - total_leads_contacted`) from the campaigns endpoint as a proxy for Task 1. This gives the same signal: if remaining leads are below threshold, sending will fall short.

**Note on sender capacity:** Use `daily_limit` per sender from the campaign sender-emails endpoint rather than hardcoding 25. Sum `daily_limit` across all connected senders to get true max daily capacity for a campaign.

---

## Task 1 — Short-Term Alert (Daily Send Volume Check)

Run for each active campaign per workspace:

1. Call `GET /api/campaigns/{id}/sender-emails` and sum `daily_limit` across all connected senders to get true max daily capacity for the campaign.
2. Get remaining leads: `total_leads - total_leads_contacted` from `GET /api/campaigns`.
3. If remaining leads < 80% of max daily capacity: flag this campaign.

**Report fields:** workspace name, campaign name, remaining leads, max daily capacity, 80% threshold, deficit.

---

## Task 2 — Runway Alert (3-Week Lead Supply Check)

Run for each active campaign:

1. Pull the campaign's daily sending volume from Campaign Settings.
2. Check how many sender accounts are assigned to the campaign.
3. Calculate 3-week lead requirement:
   - Week 1: daily send volume x 5 = new sends (Step 1 emails).
   - Weeks 2-3: follow-ups go to the same leads, consuming capacity but not requiring new leads.
   - **Total leads needed = daily send volume x 5** (one week of new leads, followed by 2 weeks of follow-ups).
4. Testing stage: new campaigns launch with ~1,000 test leads. Only apply the runway check to campaigns that have passed testing.
   - Remaining leads between 700 and 1,400 = most likely still in testing. Skip the runway check.
   - Remaining leads under 700 or over 1,400 = treat as past testing, apply the runway check normally.
5. If remaining leads < 3-week requirement: flag the campaign.

**Report fields:** campaign name, workspace, current lead count, required lead count (3-week runway), deficit.

---

## Schedule

Run both checks every day at **9:00 AM CET/CEST (Denmark time)**.

Default mode: post a **full status report every morning** (even when everything looks fine) so results can be verified. Once confirmed reliable, switch to alerts-only mode (only post when something is flagged).

---

## Output

Post all reports and alerts to Slack channel `C0B268H8Z2S`.

Each alert must include:
- Workspace name
- Campaign name
- Current lead count or queued count
- Required lead count or threshold
- The deficit

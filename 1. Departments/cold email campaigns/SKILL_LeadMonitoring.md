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
   - **Total leads needed = max_new_leads_per_day x 15** (5 sending days x 3 weeks).
   - Follow-ups do not consume new leads. Each lead gets 1 initial + 2 follow-ups, but it is the same person. Lead burn rate = max_new_leads_per_day only.
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

Post to Slack channel `C0B268H8Z2S` as **two separate messages** (one per task).

### Formatting rules

1. Group by client. Use `*CLIENT NAME*` (bold, uppercase) as section headers.
2. Sort clients by total deficit descending (most critical first).
3. Sort campaigns within each client by deficit descending.
4. Use inline code backticks for remaining counts: `0`, `24`, `145`.
5. Show deficit in parentheses after each line: `(deficit: 300)`.
6. Emoji at top of each message only: 🔴 daily supply, 🟠 runway, 🟢 all healthy.
7. Collapse "Follow Ups" campaigns: if multiple clients have Follow Ups at 0, show a summary line at the bottom: `_N Follow Up queues are also at 0._`
8. Add a summary line at the top: `X of Y campaigns flagged`.
9. Only include flagged campaigns. Skip healthy ones.
10. No tables. No pipe separators. No capacity/threshold numbers (they're the same for everything and add noise). Bullet lists only.
11. Keep lines under 60 characters for mobile readability.
12. Split daily vs runway into separate messages.

### Message 1 format (Daily Supply)

```
🔴 *Daily lead supply* — May 7, 2026
17 of 33 campaigns flagged (below 80% capacity)

*ACT CAPITAL* — 6 campaigns, all critical
• Tequila (PE/FO Owners) — `11` left (deficit: 289)
• Tequila (Shared List) — `0` (deficit: 300)
• Sell Side Advisory — `0` (deficit: 300)
• Excavation (Buyer) — `0` (deficit: 300)
• Northern Cali — `0` (deficit: 300)

*VENTURE EXITS* — 2 campaigns
• Yoga (PE/FO) — `24` left (deficit: 276)
• Yoga (Strategic) — `145` left (deficit: 155)

*ITG GROUP* — 1 campaign
• Managers Campaign — `4` left (deficit: 296)

_33 campaigns checked across 16 workspaces_
```

### Message 2 format (3-Week Runway)

```
🟠 *3-Week runway* — May 7, 2026
21 of 33 campaigns flagged (below 3-week supply)

*ACT CAPITAL* — 5 campaigns
• Sell Side Advisory — `0` / 5,500 needed (deficit: 5,500)
• Tequila (PE/FO) — `11` / 1,000 needed (deficit: 989)
• Excavation (Buyer) — `0` / 1,000 needed (deficit: 1,000)
• Northern Cali — `0` / 1,000 needed (deficit: 1,000)
• Tequila (Shared List) — `0` / 175 needed (deficit: 175)

_33 campaigns checked across 16 workspaces_
```

### What NOT to do
- No raw pipe-separated data
- No Slack block kit tables
- No capacity/threshold numbers in the output
- No color attachments
- No single giant message combining both tasks

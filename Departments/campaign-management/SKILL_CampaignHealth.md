# Skill: Campaign Health Check

## What this skill does
Checks all active EmailBison campaigns across every client workspace.
For each campaign it tells you:
- How many new leads are contacted per day
- How many leads are left in the pipeline (not yet contacted)
- Whether the campaign has enough leads to send for the full week
- How many leads need to be added if it's running short

---

## When to run this
Run this every Monday before the week starts, or any time you want to check
if a campaign will run out of leads mid-week.

---

## How to run

Ask Claude:
> "Run the campaign health check"

Or be more specific:
> "Check campaign health for 911 Restoration"
> "Which campaigns are running out of leads this week?"
> "How many leads does ACT Capital need to add?"

---

## What Claude will do

1. Read all workspaces from the database (`workspaces` table on Hetzner PostgreSQL)
2. For each workspace, call the EmailBison API: `GET /api/campaigns`
3. For each active campaign, calculate:
   - `new_leads_per_day` = `max_new_leads_per_day` from EmailBison
   - `weekly_capacity` = `new_leads_per_day × 5 sending days`
   - `remaining` = `total_leads - total_leads_contacted`
   - `shortfall` = `weekly_capacity - remaining` (if negative, campaign is short)
4. Flag any campaign that is:
   - **Empty** — 0 leads remaining, nothing will send
   - **Critical** — less than 50% of weekly capacity remaining
   - **Low** — some shortfall but still sending
   - **Healthy** — enough leads for the full week
5. Output a plain English summary grouped by client

---

## Output format Claude should use

For each client workspace, output like this:
# Skill: Campaign Health Check

## What this skill does
Checks all active EmailBison campaigns across every client workspace.
For each campaign it tells you:
- How many new leads per day the campaign is set to contact
- Weekly sending capacity (new leads/day × 5 sending days)
- How many leads are remaining (not yet contacted)
- Whether there's a shortfall — and exactly how many leads to add

---

## When to run this
Every Monday before the week starts, or any time you want to check
if a campaign will run out of leads mid-week.

---

## How to run
Ask Claude:
> "Run the campaign health check"
> "Check campaign health for 911 Restoration"
> "Which campaigns are running out of leads this week?"
> "How many leads does ACT Capital need to add?"

---

## What Claude will do

1. Read all workspaces from the `workspaces` table on Hetzner PostgreSQL
2. For each workspace call EmailBison: `GET /api/campaigns`
3. Filter for active campaigns only (status = Active)
4. For each campaign calculate:
   - `new_leads_per_day` = `max_new_leads_per_day` from the campaign
   - `weekly_capacity` = `new_leads_per_day × 5`
   - `remaining` = `total_leads - total_leads_contacted`
   - `shortfall` = `max(0, weekly_capacity - remaining)`
   - `coverage_pct` = `remaining / weekly_capacity × 100`
5. Flag status:
   - **Empty** — remaining = 0, nothing will send
   - **Critical** — coverage under 50%
   - **Low** — some shortfall but still sending
   - **Healthy** — enough leads for the full week
6. Output plain English summary grouped by client

---

## Output format
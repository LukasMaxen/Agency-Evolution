# Skill: Lead Monitoring and Slack Alert System

## Platform
EmailBison. Each sender account sends 25 emails/day. Sending days are Monday-Friday only (5 days/week). All volume and runway calculations use 5 sending days, not 7.

**Workspace max daily capacity** = sender accounts x 25.

---

## Task 1 — Short-Term Alert (Daily Send Volume Check)

Run for each workspace:

1. Pull sender accounts for the workspace: count how many exist.
2. Calculate max daily volume: sender accounts x 25.
3. Check leads queued for **day after tomorrow** (use the sending schedule date dropdown).
4. If queued leads < 80% of max daily volume: flag this workspace.
   - Identify which active campaigns are short on leads.

**Report fields:** workspace name, campaign name(s) short on leads, current queued count, required count (80% threshold), deficit.

---

## Task 2 — Runway Alert (3-Week Lead Supply Check)

Run for each active campaign:

1. Pull the campaign's daily sending volume from Campaign Settings.
2. Check how many sender accounts are assigned to the campaign.
3. Calculate 3-week lead requirement:
   - Week 1: daily send volume x 5 = new sends (Step 1 emails).
   - Weeks 2-3: follow-ups go to the same leads, consuming capacity but not requiring new leads.
   - **Total leads needed = daily send volume x 5** (one week of new leads, followed by 2 weeks of follow-ups).
4. Testing stage: new campaigns launch with ~1,000 test leads. Only apply the runway check to campaigns that have passed testing (i.e., are running at full scale).
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

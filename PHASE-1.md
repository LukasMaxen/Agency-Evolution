MAXEN PARTNERS — PHASE 1 TEAM ACTION PLAN
Weeks 1–2


Goal: Stop leads falling through the cracks. Automate follow-ups. Give the team
a daily briefing. Seed the CRM. Document what's working before it's forgotten.


════════════════════════════════════════
LUKAS
════════════════════════════════════════

1.  Build campaign monitor + diagnostic logic tree
    Build /api/campaigns/health — pulls reply rate, interested rate, open rate,
    and bounce rate for every active campaign. Runs each through the logic tree
    below to diagnose the root cause, then posts a prioritised action list to
    Slack every Monday morning.

    DIAGNOSTIC LOGIC TREE

    Campaign underperforming
    │
    ├── Open rate low
    │   Deliverability issue
    │   ├── Bounce rate high   →  sender or domain problem, pause and investigate
    │   ├── Spam complaints    →  content or sending frequency issue
    │   └── Subject line       →  test a new subject, reduce aggressive language
    │
    ├── Open rate OK, reply rate low
    │   Targeting or Offer issue
    │   ├── One segment still replying  →  narrow ICP to that segment only
    │   ├── No segments replying        →  the offer is not landing, run CampaignImprove
    │   └── Review reply themes         →  what are people saying when they decline?
    │
    ├── Reply rate OK, interested rate low
    │   Product-market fit issue
    │   Reaching the right person but the offer does not fit their situation.
    │   Reposition the offer or test a different angle.
    │
    └── All rates OK, meetings not booking
        Reply management or Calendly friction
        Check FU sequence is running, Calendly link is correct, reply speed.


2.  Nurture capture
    Modify the auto-reply processor so that when a lead says "reach back in
    6 months" or similar, instead of doing nothing, they get written to the
    crm_contacts table with a future contact date. These leads are currently
    just disappearing.


3.  Create crm_contacts table
    Run SQL migration: id, workspace_slug, lead_email, lead_name,
    lead_company, status, source_reply_id, future_contact_date, notes, created_at


4.  Build daily briefing
    Build /api/briefing/daily — aggregates new replies waiting, follow-ups due
    today, any campaigns below KPI threshold, today's scheduled meetings.
    Posts to Slack as a formatted morning summary at 8am on weekdays.


5.  Write CONTEXT_CRM.md
    Define what a seller contact is, what a deal is, the pipeline stage names,
    and how the buyer database will work. This becomes the reference document
    for everything built in Phase 4.


════════════════════════════════════════
KASPER
════════════════════════════════════════

1.  Add files:read scope to the Slack bot
    Go to api.slack.com/apps
    Select Claude Bot → OAuth & Permissions → Bot Token Scopes
    Add files:read
    Reinstall the app and share the new bot token with Lukas
    This unblocks the Slack huddle sync — once done, Claude can pull daily
    team standup notes automatically and push updates to client files.


2.  Write CONTEXT_OfferLibrary.md
    This is the most important thing we do not have yet.
    Your campaign experience needs to be in the system, not just in your head.
    For every active client write down:

      3 to 5 hooks or angles that have actually generated replies
      2 to 3 things that did not work and why
      Best subject lines you have used
      CTAs that convert
      Proven P.S. lines if used

    This is what Claude pulls from every time it writes or improves a script.
    The better this document is, the better every future campaign will be.


3.  Define KPI thresholds for the campaign monitor
    Confirm what counts as a pass, a warning, and a fail for each metric.
    These numbers go directly into the campaign monitor so it knows what to flag.

    Suggested starting point — adjust based on what you have seen:

      Open rate        fail < 30%     warning 30–45%     pass > 45%
      Reply rate       fail < 3%      warning 3–6%       pass > 6%
      Interested rate  fail < 1%      warning 1–3%       pass > 3%
      Bounce rate      fail > 5%      warning 3–5%       pass < 3%

    Also flag: any campaign running 30+ days with zero interested replies.


════════════════════════════════════════
SUNNY
════════════════════════════════════════

1.  Add FATHOM_API_KEY to Coolify
    Fathom meeting sync is live locally but not in production.
    Add the env var so the midnight cron job can run it.


2.  Confirm SLACK_BOT_TOKEN is in Coolify
    Slack notifications appear to be working in production already.
    Just confirm the token is set so we do not lose it on a redeploy.


3.  Get Apollo API key
    Log into the Apollo account, generate an API key,
    add it to Coolify and to .env.local as APOLLO_API_KEY.
    This is the prerequisite for everything in Phase 2.


4.  Build /api/follow-ups/process
    Query the follow_ups table for leads where next_fu_due is today or earlier
    and meeting_booked is false.
    For each lead, read the client file, use Claude to draft the correct FU step,
    send it via EmailBison, mark it sent, and update next_fu_due for the next step.
    This is the biggest revenue leak in the system right now — interested leads
    going cold because no one has time to manually follow up.


5.  Build /api/apollo/search
    Accepts a query object: titles, industries, locations, company size.
    Calls the Apollo People Search API and returns a paginated contact list.
    Auth via APOLLO_API_KEY.
    This is the foundation for the entire lead sourcing engine in Phase 2.


6.  Set up cron jobs in Coolify
    Follow-up processing     every 2 hours
    Daily briefing           8:00 AM weekdays
    Campaign health check    Monday 7:00 AM
    Fathom sync              midnight daily


════════════════════════════════════════
ONGOING — from Phase 1 onwards every week
════════════════════════════════════════

Deliverability audit     Every Monday
                         Check all sending domains: bounce rate, blacklist, spam rate
                         Post results to Slack
                         Flag any sender approaching the 3% bounce threshold

ICP validation           Every 500 sends per campaign
                         Compare interested rate by title, industry, company size
                         Surface best and worst performing segments
                         Update ICP definition in the client file

Offer optimization       Every 500 sends per variant
                         Compare reply rate by hook and angle
                         Flag losing variants, lock winning copy into offer library

# Maxen Partners — Automation System


## The Three Pillars

Everything we build serves one of these three:

    DELIVERABILITY   →   message lands in inbox, sender is clean and healthy
    TARGETING        →   right person: industry, title, size, geography
    OFFER            →   right message: hook, value prop, CTA, product-market fit


---


## Full System Structure

    ✅ = exists        ○ = needs to be built        ⊘ = blocked


    MAXEN PARTNERS AUTOMATION SYSTEM
    │
    ├── DEPT 1  COLD EMAIL CAMPAIGNS                          Kasper
    │   │
    │   ├── Context
    │   │   ├── ✅  CONTEXT_Campaign          global campaign rules
    │   │   └── ○   CONTEXT_OfferLibrary      proven hooks, ranked angles, what doesn't work, by industry
    │   │
    │   └── Skills
    │       ├── ✅  SKILL_WriteScript          writes 3-step cold email sequences
    │       ├── ✅  SKILL_CampaignQA           pre-launch checklist
    │       ├── ○   SKILL_CampaignMonitor      tracks KPIs per campaign, flags winners + failures, runs diagnostic logic tree
    │       ├── ○   SKILL_CampaignImprove      triggered by CampaignMonitor — diagnoses root cause, proposes line-level changes
    │       ├── ○   SKILL_NewCampaign          end-to-end: brief → script → QA → push live
    │       ├── ○   SKILL_OfferDevelopment     new offer angle: hooks, proof points, CTAs
    │       ├── ○   SKILL_OfferOptimization    after 500 sends: variant analysis, recommendations
    │       ├── ○   SKILL_DeliverabilityAudit  weekly: bounce rate, blacklist, spam rate per sender
    │       └── ○   SKILL_VariantRefreshAuto   detects threshold hits, generates refresh, posts for approval
    │
    │
    ├── DEPT 2  LEAD SOURCING                                 Sunny + Kasper
    │   │
    │   ├── Context
    │   │   └── ○   CONTEXT_LeadSourcing       ICP process, Apollo search logic, title batches by industry
    │   │
    │   └── Skills
    │       ├── ○   SKILL_ICPResearch          defines ICP: sectors, titles, size, geo, Boolean strings
    │       ├── ○   SKILL_ApolloSearch         executes Apollo query, pagination, deduplication
    │       ├── ○   SKILL_LeadEnrichment       enriches contacts: revenue, news, LinkedIn, personalisation
    │       ├── ○   SKILL_LeadScoring          scores each lead 1–10 vs ICP, filters disqualifiers
    │       ├── ○   SKILL_EmailVerification    validates list before upload, removes invalid/risky
    │       ├── ○   SKILL_PersonalisationGen   generates opening line per lead using context/title/city
    │       ├── ○   SKILL_TitleResearch        best titles per ICP, tests variations, ranks by reply rate
    │       └── ○   SKILL_ICPValidation        after 500 sends: which segments convert → update ICP
    │
    │
    ├── DEPT 3  REPLY MANAGEMENT                              Lukas
    │   │
    │   ├── Context
    │   │   └── ✅  CONTEXT_Replies            global reply rules
    │   │
    │   └── Skills
    │       ├── ✅  SKILL_Reply-Management     reply drafting
    │       ├── ✅  SKILL_LeadMonitoring       campaign capacity check
    │       ├── ○   SKILL_FUSequenceAuto       cron-driven: checks follow-ups table, sends due FU step
    │       ├── ○   SKILL_NurtureCapture       detects "reach back in X months", writes to CRM
    │       └── ○   SKILL_TeaserDelivery       detects "send teaser/NDA" intent, auto-sends document
    │
    │
    ├── DEPT 4  CRM & PIPELINE                                Lukas
    │   │
    │   ├── Context
    │   │   └── ○   CONTEXT_CRM               seller nurture, deal stages, buyer mandates structure
    │   │
    │   └── Skills
    │       ├── ○   SKILL_NurtureReEngage      cron: contacts due for re-engagement → draft and send
    │       ├── ○   SKILL_DealPipeline         create/update deal stages: interest → NDA → CIM → closed
    │       ├── ○   SKILL_BuyerDatabase        add/update buyer profiles: mandates, sectors, deal size
    │       └── ○   SKILL_BuyerMatching        new sell-side mandate → surfaces top matching buyers
    │
    │
    ├── DEPT 5  CLIENT MANAGEMENT                             Lukas
    │   │
    │   └── Skills
    │       ├── ○   SKILL_BiweeklyPrep         before each call: stats, reply themes, open action items
    │       ├── ○   SKILL_ClientReport         weekly: leads contacted, reply rate, meetings, pipeline
    │       ├── ○   SKILL_ClientHealthScore    aggregate score: performance + activity + pipeline + renewal
    │       ├── ○   SKILL_MeetingActionItems   after Fathom sync: extracts action items to client file
    │       └── ○   SKILL_OnboardingMilestones tracks contract signed → first send live
    │
    │
    ├── DEPT 6  OPERATIONS & INTELLIGENCE                     Lukas
    │   │
    │   └── Skills
    │       ├── ○   SKILL_DailyBriefing        8am Slack: urgent replies, below-KPI campaigns, FUs due
    │       ├── ○   SKILL_WeeklyReview         Friday wrap: performance vs prior week, what's next
    │       ├── ⊘   SKILL_SlackHuddleSync      blocked — Kasper needs to add files:read scope to Slack bot
    │       ├── ✅  SKILL_FileRouter            content routing
    │       ├── ✅  SKILL_IntakeClient          new client interview
    │       └── ✅  SKILL_OnboardClient         full onboarding SOP
    │
    │
    ├── DEPT 7  MULTI-CHANNEL                                 Kasper + Sunny  (future)
    │   │
    │   ├── Context
    │   │   ├── ○   CONTEXT_LinkedIn           acceptance rate benchmarks, connection norms
    │   │   └── ○   CONTEXT_ColdCalling        call script structure, objection norms, voicemail rules
    │   │
    │   └── Skills
    │       ├── ○   SKILL_LinkedInScript       connection request + 3-step follow-up sequences
    │       ├── ○   SKILL_LinkedInICP          Sales Navigator targeting: titles, seniority, size
    │       ├── ○   SKILL_ColdCallScript       call script + objection handling guide per campaign
    │       └── ○   SKILL_AdCopy               Meta/LinkedIn ad copy + lead form questions
    │
    │
    ├── DEPT 8  FINANCE & REVENUE                             Lukas
    │   │
    │   └── Skills
    │       ├── ○   SKILL_RevenueReport        monthly: MRR per client, total revenue, overdue invoices
    │       └── ○   SKILL_PipelineValue        active M&A deals × commission rate = projected revenue
    │
    │
    └── DEPT 9  SALES / AGENCY GROWTH                        Lukas
        │
        └── Skills
            ├── ○   SKILL_SalesCallPrep        research prospect firm: M&A activity, team, pain points
            └── ○   SKILL_ProposalDraft        after discovery: scope, output, pricing, case study selection


---


## Build Phases

    Phase 1  Weeks 1–2    Close Revenue Leaks
    Phase 2  Weeks 3–5    Lead Sourcing Engine
    Phase 3  Weeks 6–8    Campaign Intelligence
    Phase 4  Weeks 9–12   CRM & Pipeline
    Phase 5  Weeks 13–16  Client Management & Reporting
    Phase 6  Weeks 17–20  Multi-Channel


---


# Phase 1 — Team Action Plan
### Weeks 1–2


Goal: Stop leads falling through the cracks. Automate follow-ups. Seed the CRM.
Give the team a daily briefing. Document what's working before it's forgotten.


---


## Lukas


    1.  Build /api/campaigns/health + SKILL_CampaignMonitor
        Pull reply rate, interested rate, open rate, and bounce rate for every
        active campaign across all workspaces from the DB.
        Run each campaign through the diagnostic logic tree below.
        Output a prioritised action list: which campaigns need attention and why.
        Post a summary to Slack every Monday morning.

        DIAGNOSTIC LOGIC TREE
        ─────────────────────
        Campaign flagged as underperforming
        │
        ├── Open rate low
        │   └── Deliverability issue
        │       ├── Bounce rate high   →  sender or domain problem, pause and investigate
        │       ├── Spam complaints    →  content or sending frequency issue
        │       └── Subject line       →  test a new subject, reduce aggressive language
        │
        ├── Open rate OK, reply rate low
        │   └── Targeting or Offer issue
        │       ├── Check segment performance — which titles and industries are replying?
        │       │   ├── One segment performing   →  narrow ICP to that segment only
        │       │   └── No segments performing   →  the offer is not landing, run CampaignImprove
        │       └── Review reply themes — what are people saying when they ignore or decline?
        │
        ├── Reply rate OK, interested rate low
        │   └── Product-market fit issue
        │       Reaching the right person but the offer does not fit their situation.
        │       Review interested reply themes and consider repositioning the offer.
        │
        └── All rates OK, meetings not booking
            └── Reply management or Calendly friction
                Check FU sequence is running, check Calendly link is correct, check reply speed.

    2.  Nurture capture
        Add "nurture" intent to the auto-reply processor.
        When a lead says "reach back in 6 months" or similar, instead of doing
        nothing, write them to the crm_contacts table with a future_contact_date.
        File: app/api/auto-reply/processor.ts

    2.  Create crm_contacts table
        Run SQL migration to create the table:
        id, workspace_slug, lead_email, lead_name, lead_company,
        status, source_reply_id, future_contact_date, notes, created_at

    3.  Build /api/briefing/daily
        Pulls together: new replies waiting, FUs due today, any campaigns
        below 5% reply rate, meetings on the Fathom calendar.
        Posts as a formatted Slack message to #team-chat every morning.

    4.  Write SKILL_DailyBriefing.md
        Document the prompt and structure for the morning briefing.

    5.  Write CONTEXT_CRM.md
        Define what a seller contact is, what a deal is, the stage names,
        and how the buyer database will work. This is the reference doc
        for everything we build in Phase 4.


---


## Kasper


    1.  Add files:read scope to the Slack bot
        Go to api.slack.com/apps
        Select Claude Bot → OAuth & Permissions → Bot Token Scopes
        Add files:read
        Reinstall the app
        Share the new bot token with Lukas
        This unblocks the Slack huddle sync feature entirely.

    2.  Write CONTEXT_OfferLibrary.md
        This is the most important document we don't have yet.
        For every active client, write down:
          - 3 to 5 hooks or angles that have generated real replies
          - 2 to 3 things that didn't work and why
          - The best subject lines you've used
          - The CTAs that convert
          - Any proven P.S. lines
        This becomes the reference Claude pulls from when writing
        or improving any script going forward. Your experience
        needs to be in the system, not just in your head.

    3.  Define KPI thresholds for campaign monitor
        For each metric below, confirm what counts as a pass, a warning, and a fail.
        These thresholds go into SKILL_CampaignMonitor so it knows what to flag.
        Suggested starting point — adjust based on your experience:

          Open rate       fail < 30%    warning 30–45%    pass > 45%
          Reply rate      fail < 3%     warning 3–6%      pass > 6%
          Interested rate fail < 1%     warning 1–3%      pass > 3%
          Bounce rate     fail > 5%     warning 3–5%      pass < 3%

        Also flag: any campaign running 30+ days with zero interested replies.


---


## Sunny


    1.  Add FATHOM_API_KEY to Coolify
        The Fathom meeting sync is live locally but not in production.
        Add the env var so it runs on the cron job.

    2.  Confirm SLACK_BOT_TOKEN is in Coolify
        Slack notifications appear to be working in production already —
        just confirm the token is set so we don't lose it.

    3.  Get Apollo API key
        Log into the Apollo account, generate an API key,
        add it to Coolify and to .env.local as APOLLO_API_KEY.
        This is the prerequisite for everything in Phase 2.

    4.  Build /api/follow-ups/process
        Query the follow_ups table for leads where:
          next_fu_due is today or earlier
          meeting_booked is false
        For each lead, read the client file, use Claude to draft
        the correct FU step, send it via EmailBison, mark it sent,
        and update next_fu_due for the next step.
        This is the biggest revenue leak we have right now.

    5.  Build /api/apollo/search
        Accepts a query object: titles, industries, locations, company size.
        Calls the Apollo People Search API.
        Returns a paginated contact list.
        Auth via APOLLO_API_KEY.

    6.  Set up cron jobs in Coolify
        Follow-up processing    every 2 hours
        Daily briefing          8:00 AM weekdays
        Campaign health check   Monday 7:00 AM
        Fathom sync             midnight daily


---


## Ongoing — runs every week from Phase 1 onwards

    Deliverability audit    Every Monday
                            Check all sending domains: bounce rate, blacklist status, spam rate
                            Post results to Slack
                            Flag any sender approaching the 3% bounce threshold

    ICP validation          Every 500 sends per campaign
                            Compare interested rate by title, industry, company size
                            Surface the best and worst performing segments
                            Update the ICP definition in the client file

    Offer optimization      Every 500 sends per variant
                            Compare reply rate by hook and angle
                            Flag losing variants, lock winning copy into offer library

MAXEN PARTNERS — CLAUDE CODE SYSTEM OVERVIEW
Full department, context, and skill structure


════════════════════════════════════════
THE THREE PILLARS
Everything we build serves one of these three
════════════════════════════════════════

DELIVERABILITY   message lands in inbox, sender is clean and healthy
TARGETING        right person: industry, title, company size, geography
OFFER            right message: hook, value prop, CTA, product-market fit


════════════════════════════════════════
HOW THE SYSTEM LEARNS
This is not a static system — it compounds over time
════════════════════════════════════════

Every skill either reads from what was learned before, writes back what it
just learned, or both. The context files and client files are the brain.
The longer the system runs, the smarter they get.

Campaign outcomes  →  ICP definitions and offer library get updated
Reply data         →  reply guidelines in client files get updated
Human corrections  →  captured and written as new rules for next time
Meetings           →  summaries, feedback, and action items written to client files
Monitor flags      →  diagnosis written to client file, fix queued automatically

Month one:  Claude works from the original onboarding context
Month six:  Claude works from six months of campaign data, reply outcomes,
            client feedback, and meeting notes — all written back automatically


════════════════════════════════════════
FULL SYSTEM STRUCTURE
✅ exists   ○ needs to be built   ⊘ blocked
════════════════════════════════════════


DEPT 1  COLD EMAIL CAMPAIGNS                                       Kasper
──────────────────────────────────────────────────────────────────────────

  Context
    ✅  CONTEXT_Campaign          global campaign rules
    ○   CONTEXT_OfferLibrary      proven hooks, ranked angles, what doesn't work, by industry
                                  grows automatically as offer optimization runs

  Skills
    ✅  SKILL_WriteScript          writes 3-step cold email sequences
    ~   SKILL_CampaignQA           pre-launch checklist — file exists, content needs Kasper review
    ○   SKILL_CampaignMonitor      tracks KPIs per campaign, flags winners and failures,
                                   runs diagnostic logic tree, writes diagnosis to client file
    ○   SKILL_CampaignImprove      triggered by CampaignMonitor — diagnoses root cause,
                                   proposes line-level changes, updates client file
    ○   SKILL_NewCampaign          end-to-end: brief → script → QA → push live
    ○   SKILL_OfferDevelopment     new offer angle from client brief: hooks, proof points, CTAs
    ○   SKILL_OfferOptimization    after 500 sends: variant analysis, locks winners into offer library
    ○   SKILL_DeliverabilityAudit  weekly: bounce rate, blacklist, spam rate per sender
    ○   SKILL_VariantRefreshAuto   detects threshold hits, generates refresh, posts for approval


DEPT 2  LEAD SOURCING                                         Sunny + Kasper
──────────────────────────────────────────────────────────────────────────

  Context
    ○   CONTEXT_LeadSourcing       ICP process, Apollo search logic, title batches by industry

  Skills
    ○   SKILL_ICPResearch          defines ICP: sectors, titles, size, geo, Boolean strings
    ○   SKILL_ApolloSearch         executes Apollo query, pagination, deduplication
    ○   SKILL_LeadEnrichment       enriches contacts: revenue, news, LinkedIn, personalisation
    ○   SKILL_LeadScoring          scores each lead 1–10 vs ICP, filters disqualifiers
    ○   SKILL_EmailVerification    validates list before upload, removes invalid and risky
    ○   SKILL_PersonalisationGen   generates opening line per lead using context, title, city
    ○   SKILL_TitleResearch        best titles per ICP, tests variations, ranks by reply rate
    ○   SKILL_ICPValidation        after 500 sends: which segments convert → updates ICP in client file


DEPT 3  REPLY MANAGEMENT                                           Lukas
──────────────────────────────────────────────────────────────────────────

  Context
    ✅  CONTEXT_Replies            global reply rules

  Skills
    ✅  SKILL_Reply-Management     reply drafting
    ✅  SKILL_LeadMonitoring       campaign capacity check
    ○   SKILL_FUSequenceAuto       cron-driven: checks follow-ups table, sends due FU step
    ○   SKILL_NurtureCapture       detects "reach back in X months", writes to CRM with future date
    ○   SKILL_ReplyTraining        captures human corrections to auto-replies, writes new rules to client file
    ○   SKILL_TeaserDelivery       detects "send teaser / NDA" intent, auto-sends document, logs on deal


DEPT 4  CRM & PIPELINE                                             Lukas
──────────────────────────────────────────────────────────────────────────

  Context
    ○   CONTEXT_CRM                seller nurture, deal stages, buyer mandates structure

  Skills
    ○   SKILL_NurtureReEngage      cron: contacts due for re-engagement → draft and send
    ○   SKILL_DealPipeline         create and update deal stages: interest → NDA → CIM → closed
    ○   SKILL_BuyerDatabase        add and update buyer profiles: mandates, sectors, deal size
    ○   SKILL_BuyerMatching        new sell-side mandate → surfaces top matching buyers by fit score


DEPT 5  CLIENT MANAGEMENT                                          Lukas
──────────────────────────────────────────────────────────────────────────

  Skills
    ○   SKILL_BiweeklyPrep         before each call: stats, reply themes, open action items
    ○   SKILL_ClientReport         weekly: leads contacted, reply rate, meetings, pipeline
    ○   SKILL_ClientHealthScore    aggregate score: performance + activity + pipeline + renewal risk
    ○   SKILL_MeetingActionItems   after Fathom sync: extracts action items, adds to client file
    ○   SKILL_OnboardingMilestones tracks contract signed → first send live with milestone checklist


DEPT 6  OPERATIONS & INTELLIGENCE                                  Lukas
──────────────────────────────────────────────────────────────────────────

  Skills
    ○   SKILL_DailyBriefing        8am Slack: urgent replies, below-KPI campaigns, FUs due today
    ○   SKILL_WeeklyReview         Friday wrap: performance vs prior week, what changed, what's next
    ⊘   SKILL_SlackHuddleSync      blocked — Kasper needs to add files:read scope to Slack bot
    ✅  SKILL_FileRouter            content routing
    ✅  SKILL_IntakeClient          new client interview
    ✅  SKILL_OnboardClient         full onboarding SOP


DEPT 7  MULTI-CHANNEL                                    Kasper + Sunny (future)
──────────────────────────────────────────────────────────────────────────

  Note: client files already carry offer, ICP, and positioning across channels.
  Same context. Same offer. New delivery channel.

  Context
    ○   CONTEXT_LinkedIn           acceptance rate benchmarks, connection norms, profile standards
    ○   CONTEXT_ColdCalling        call script structure, objection norms, voicemail rules

  Skills
    ○   SKILL_LinkedInScript       connection request + 3-step follow-up message sequences
    ○   SKILL_LinkedInICP          Sales Navigator targeting: titles, seniority, company size
    ○   SKILL_ColdCallScript       call script + objection handling guide per campaign
    ○   SKILL_AdCopy               Meta and LinkedIn ad copy + lead form questions

  Tools needed: LinkedIn automation (Heyreach or Expandi), Calling tool (Salesfinity or Nooks)


DEPT 8  FINANCE & REVENUE                                          Lukas
──────────────────────────────────────────────────────────────────────────

  Skills
    ○   SKILL_RevenueReport        monthly: MRR per client, total revenue, overdue invoices
    ○   SKILL_PipelineValue        active M&A deals × commission rate = projected revenue


DEPT 9  SALES / AGENCY GROWTH                                      Lukas
──────────────────────────────────────────────────────────────────────────

  Skills
    ○   SKILL_SalesCallPrep        research prospect firm: M&A activity, team, pain points
    ○   SKILL_ProposalDraft        after discovery: scope, expected output, pricing, case studies


════════════════════════════════════════
BUILD PHASES
════════════════════════════════════════

Phase 1   Weeks 1–2     Close Revenue Leaks
          Follow-up automation, nurture capture, campaign monitor, daily briefing

Phase 2   Weeks 3–5     Lead Sourcing Engine
          Apollo integration, ICP research, enrichment, scoring, verification

Phase 3   Weeks 6–8     Campaign Intelligence
          Campaign improvement loop, full campaign creation, variant refresh, offer optimization

Phase 4   Weeks 9–12    CRM & Pipeline
          Seller nurture sequences, deal pipeline, buyer database, buyer matching

Phase 5   Weeks 13–16   Client Management & Reporting
          Automated client reports, biweekly prep, client health scoring

Phase 6   Weeks 17–20   Multi-Channel
          LinkedIn infrastructure, cold calling infrastructure, paid ads lead capture


════════════════════════════════════════
AUTOMATED WEEKLY MONITORS
Run continuously from Phase 1 onwards
════════════════════════════════════════

Deliverability audit     Every Monday
                         All sending domains: bounce rate, blacklist, spam rate
                         Posts to Slack, flags any sender near the 3% threshold

Campaign health check    Every Monday
                         All active campaigns run through diagnostic logic tree
                         Diagnosis written to client file, fix queued if needed

ICP validation           Every 500 sends per campaign
                         Interested rate compared by segment
                         ICP definition in client file updated with findings

Offer optimization       Every 500 sends per variant
                         Reply rate compared by hook and angle
                         Winning copy locked into CONTEXT_OfferLibrary

Follow-up processing     Every 2 hours
                         Leads with next_fu_due in the past and no meeting booked
                         Correct FU step drafted and sent automatically

Fathom sync              Midnight daily
                         New meeting summaries written to client files and internal log

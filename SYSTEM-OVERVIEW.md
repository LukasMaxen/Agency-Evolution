# Maxen Partners — System Overview

Full department structure, skills, API routes, database, and build roadmap.
Team: Lukas Maxen (AI/ops), Kasper Zacho (campaigns), Sunny Newar (tech + lead sourcing)

---

## The Three Pillars

Everything we build serves one of these three.

| Pillar | What it means | How we measure it |
|---|---|---|
| **Deliverability** | Message lands in inbox, sender is clean and healthy | Bounce rate <3%, spam rate <0.1%, open rate vs. baseline |
| **Targeting** | Right person — industry, title, company size, geography | Interested rate by segment; ICP sharpens every 500 sends |
| **Offer** | Right message — hook, value prop, CTA, product-market fit | Reply rate by variant; winning copy locked into offer library |

---

## How the System Learns

This is not a static system — it compounds over time.

Every skill either reads from what was learned before, writes back what it just learned, or both. Context files and client files are the brain. The longer the system runs, the smarter they get.

```
Campaign outcomes    →  ICP definitions updated in client file (SKILL_ICPValidation)
                        Winning hooks locked into CONTEXT_OfferLibrary (SKILL_OfferOptimization)

Reply + FU data      →  FU outcomes (converted_at_step, outcome) feed GTM Brief reviews
                        Human corrections to auto-replies written as new rules (SKILL_ReplyTraining)
                        Nurture dates written to crm_contacts (SKILL_NurtureCapture)

Meetings             →  Summaries, feedback, action items written to client file (Fathom sync)

Monitor flags        →  Diagnosis written to client file, fix queued (SKILL_CampaignMonitor)
```

**Month 1:** Claude works from the original onboarding context.
**Month 6:** Claude works from six months of campaign data, reply outcomes, client feedback, FU conversion patterns, and meeting notes — all written back automatically.

---

## Client File Structure

Every client has a single file at `clients/[slug].md` — the source of truth for every task.

### Sections in every client file

| Section | What it contains |
|---|---|
| Quick Reference | Status, retainer, Slack channel, signed date |
| Contacts | Name, email, Calendly link, timezone, role |
| Client Type | Sell-Side M&A Advisor or Direct Buyer — determines which GTM Brief drivers apply |
| Client Overview | What they do, differentiators, hard constraints |
| GTM Brief | Full psychological research layer — see below |
| Active Campaigns | One block per campaign: offer, ICP, script rules, reply guidelines, FU context |
| Case Studies | Living table — grows as deals close, used in FU3 for industry matching |
| Campaign History | Performance data, what changed, what was learned |
| Key Conversations | Slack messages, meeting notes, client feedback |
| Internal Notes | Quirks, sensitivities, relationship context |

### GTM Brief

The GTM Brief is the psychological research layer — the equivalent of a brand onesheet adapted for B2B M&A. Populated during client intake (SKILL_IntakeClient Sections 2b and 3b). Every AI-drafted reply, follow-up, and script draws from it.

**Two client types, two sets of drivers:**

**Sell-Side M&A Advisor** (they represent sellers — outreach targets business owners):
Primary drivers: Financial Security, Legacy, Freedom/Optionality, Fear of Missing the Window, Distrust of Process, Control

**Direct Buyer** (PE firm, strategic, or family office — approaches owners directly):
Primary drivers: Curiosity/Validation, Financial Security, Legacy, Optionality, Distrust

**8 sections in every GTM Brief:**
1. Client Type + offer summary
2. Psychological Drivers — top 3–6, with the proof point or phrase that activates each
3. Trigger Events — moments that make a prospect receptive, with the hook that lands in each moment
4. ICP Personas — 2–4 distinct types within the target audience, with the lead angle for each
5. Offer Frames — 5 ways to position the same offer with a different angle (keeps FUs fresh)
6. Proof Points & Case Studies — at least 3, each tagged to the persona or trigger it's most relevant for
7. Objections & Reframes — top 5 objections with the correct response to each; flags hard dead-ends vs. soft timing issues
8. Language That Works / Doesn't Work — exact phrases, subject lines, CTAs that have gotten replies; angles that have flopped

---

## Follow-Up System

### Sequence structure

5-step, fully AI-drafted per lead. No fixed templates — the client file scaffolding (angle, P.S. pattern) is fixed but every email is written fresh using everything known about that lead.

| Step | Timing | Angle | Booking prompt |
|---|---|---|---|
| FU1 | +2 days after reply | Address their specific objection + sector reference + partial sale angle if not raised | 2 slots + Calendly link |
| FU2 | +5 days after FU1 | Sector-specific market dynamic or buyer activity hook. Low-commitment framing. | Calendly link only |
| FU3 | +7 days after FU2 | Case study matched to their industry. Fall back to most transferable if no match. | 2 slots + Calendly link |
| FU4 | +7 days after FU3 | Active mandate + sector or geography-specific urgency hook. Mild urgency only. | Calendly link only |
| FU5 | +14 days after FU4 | Soft break-up. References company name. Leaves door genuinely open. | Optional |

### Sequence assignment logic

Sequence type is assigned at reply processing time based on Claude's intent classification.

| Reply type | Intent signal | Sequence assigned |
|---|---|---|
| Interested / urgent | "Open to a chat", "Let's move quickly" | Full (5 steps) |
| Needs info — went cold | Asked a question, we answered, they stopped | Full (5 steps) |
| Neutral | Vague reply, no commitment | Full (5 steps) |
| Soft objection / timing | "Not right now", "Too busy", "Happy as is" | Abbreviated (2 steps) |
| Hard no / disqualified | "Sold last year", "We never do M&A" | None |
| Unsubscribe | "Remove me", "Stop contacting me" | Confirmation email only |
| Booked a call | Meeting confirmed | Call flow — no FUs |

**Abbreviated sequence:** FU1 (objection reframe) → FU5 (break-up) 7 days later. 2 touches total.
Encoded in `follow_ups.total_emails`: full = 5, abbreviated = 2.

### Outcome tracking

Every completed sequence logs an outcome in `follow_ups`:

| Field | Values |
|---|---|
| `converted_at_step` | Which FU step triggered a reply or booking |
| `outcome` | `booked` / `re_engaged` / `exhausted` / `unsubscribed` |
| `fu_sequence_type` | `full` / `abbreviated` |

This is the data layer for the learning loop. After every 10–20 sequences per client: which step converts most, which case studies re-engage leads, which objection reframes land — fed back into the GTM Brief.

### Approval mode

`workspaces.fu_approval_mode` (boolean, default `true`).

When **on**: FU draft saved to `follow_up_drafts` table with `status = 'pending'`, Slack notification posted for team review. Team approves or edits before send.
When **off**: Auto-sends immediately.

Graduation path: run 10 FUs per client with approval on → review quality → turn off when output is trusted.

---

## Department Map

```
✅ exists   ~ exists but needs review   ○ build   ⊘ blocked
```

---

### Dept 1 — Cold Email Campaigns `Kasper`

| | Name | Status | Notes |
|---|---|---|---|
| Context | `CONTEXT_Campaign` | ✅ | Global campaign rules |
| Context | `CONTEXT_OfferLibrary` | ○ | Proven hooks, ranked angles, by industry — grows via SKILL_OfferOptimization |
| Skill | `SKILL_WriteScript` | ✅ | Writes 3-step cold email sequences |
| Skill | `SKILL_CampaignQA` | ~ | Pre-launch checklist — content needs Kasper review |
| Skill | `SKILL_CampaignMonitor` | ○ | Daily health check, flags below-KPI campaigns, runs diagnostic logic tree |
| Skill | `SKILL_CampaignImprove` | ○ | Diagnoses underperformer, proposes line-level changes |
| Skill | `SKILL_NewCampaign` | ○ | End-to-end: brief → script → QA → push live |
| Skill | `SKILL_OfferDevelopment` | ○ | New offer angle from client brief: hooks, proof points, CTAs |
| Skill | `SKILL_OfferOptimization` | ○ | After 500 sends: variant analysis, locks winners into offer library |
| Skill | `SKILL_DeliverabilityAudit` | ○ | Weekly sender health: bounce rate, blacklist, spam rate per domain |
| Skill | `SKILL_VariantRefreshAuto` | ○ | Detects threshold hits, generates refresh copy, posts for approval |

---

### Dept 2 — Lead Sourcing `Sunny + Kasper`

| | Name | Status | Notes |
|---|---|---|---|
| Context | `CONTEXT_LeadSourcing` | ○ | ICP process, Apollo search logic, title batches by industry |
| Skill | `SKILL_ICPResearch` | ○ | Defines ICP: sectors, titles, size, geo, Boolean strings |
| Skill | `SKILL_ApolloSearch` | ○ | Executes Apollo query, pagination, deduplication |
| Skill | `SKILL_LeadEnrichment` | ○ | Enriches contacts: revenue, news, LinkedIn, personalisation fields |
| Skill | `SKILL_LeadScoring` | ○ | Scores each lead 1–10 vs ICP, filters disqualifiers |
| Skill | `SKILL_EmailVerification` | ○ | Validates list before upload, removes invalid/risky/duplicate |
| Skill | `SKILL_PersonalisationGen` | ○ | Generates opening line per lead using company context, title, city |
| Skill | `SKILL_TitleResearch` | ○ | Best titles to target per ICP; tests variations, ranks by reply rate |
| Skill | `SKILL_ICPValidation` | ○ | After 500 sends: which segments convert best → update ICP in client file |

---

### Dept 3 — Reply Management `Lukas`

| | Name | Status | Notes |
|---|---|---|---|
| Context | `CONTEXT_Replies` | ✅ | Global reply rules, FU logic tree, sequence assignment, tone and formatting rules |
| Skill | `SKILL_Reply-Management` | ✅ | Reply drafting |
| Skill | `SKILL_LeadMonitoring` | ✅ | Campaign capacity check |
| Skill | `SKILL_FUSequenceAuto` | ○ | Cron-driven: checks `follow_ups` table, drafts FU step, checks approval mode, sends or stages for review |
| Skill | `SKILL_NurtureCapture` | ○ | Detects "reach back in X months", writes to `crm_contacts` with `future_contact_date` |
| Skill | `SKILL_ReplyTraining` | ○ | Captures human corrections to auto-replies, writes new rules to client file |
| Skill | `SKILL_TeaserDelivery` | ○ | Detects "send teaser / NDA" intent, auto-sends document, logs on deal |

**Auto-reply processor** (`app/api/auto-reply/processor.ts`) handles:
- Intent classification: `interested_urgent / interested / needs_info / neutral / not_interested / unsubscribe`
- Sequence assignment: `full / abbreviated / none` written to `follow_ups.fu_sequence_type`
- Outcome tracking: `booked` and `unsubscribed` set immediately; `re_engaged` set by webhook when lead replies to a FU; `exhausted` set by FU processor when final step is reached with no response
- Approval mode check: reads `workspaces.fu_approval_mode` — saves to `follow_up_drafts` or sends directly

---

### Dept 4 — CRM & Pipeline `Lukas`

| | Name | Status | Notes |
|---|---|---|---|
| Context | `CONTEXT_CRM` | ○ | Seller nurture, deal stages, buyer mandate structure |
| Skill | `SKILL_NurtureReEngage` | ○ | Cron: finds contacts due for re-engagement today, drafts and sends |
| Skill | `SKILL_DealPipeline` | ○ | Create/update deal stages: interest → NDA → teaser → CIM → offer → closed |
| Skill | `SKILL_BuyerDatabase` | ○ | Add/update buyer profiles: mandates, sectors, deal size, geography |
| Skill | `SKILL_BuyerMatching` | ○ | Given a new sell-side mandate, surfaces top buyers from DB by fit score |

---

### Dept 5 — Client Management `Lukas`

| | Name | Status | Notes |
|---|---|---|---|
| Skill | `SKILL_BiweeklyPrep` | ○ | Before each call: campaign stats, reply themes, open action items |
| Skill | `SKILL_ClientReport` | ○ | Weekly client-facing report: leads contacted, reply rate, meetings, pipeline |
| Skill | `SKILL_ClientHealthScore` | ○ | Aggregate score: performance + activity + pipeline + renewal risk |
| Skill | `SKILL_MeetingActionItems` | ○ | After Fathom sync: extracts action items, adds checklist to client file |
| Skill | `SKILL_OnboardingMilestones` | ○ | Tracks contract signed → first send live with milestone checklist |

---

### Dept 6 — Operations & Intelligence `Lukas`

| | Name | Status | Notes |
|---|---|---|---|
| Skill | `SKILL_DailyBriefing` | ○ | 8am Slack: urgent replies, below-KPI campaigns, FUs due, today's meetings |
| Skill | `SKILL_WeeklyReview` | ○ | Friday wrap: performance vs prior week, what changed, what's next |
| Skill | `SKILL_SlackHuddleSync` | ⊘ | Blocked — Kasper needs to add `files:read` scope to Slack bot |
| Skill | `SKILL_FileRouter` | ✅ | Content routing |
| Skill | `SKILL_IntakeClient` | ✅ | New client interview — includes GTM Brief (Sections 2b and 3b) |
| Skill | `SKILL_OnboardClient` | ✅ | Full onboarding SOP |

---

### Dept 7 — Multi-Channel `Kasper + Sunny (future)`

Client files already carry offer, ICP, and GTM Brief across channels. Same context, same offer, new delivery channel.

| | Name | Status | Notes |
|---|---|---|---|
| Context | `CONTEXT_LinkedIn` | ○ | Acceptance rate benchmarks, connection norms, profile standards |
| Context | `CONTEXT_ColdCalling` | ○ | Call script structure, objection handling norms, voicemail rules |
| Skill | `SKILL_LinkedInScript` | ○ | Connection request + 3-step follow-up message sequences |
| Skill | `SKILL_LinkedInICP` | ○ | Sales Navigator targeting: industries, titles, seniority, company size |
| Skill | `SKILL_ColdCallScript` | ○ | Call script + objection handling guide per campaign |
| Skill | `SKILL_AdCopy` | ○ | Meta/LinkedIn ad copy + lead form questions from client brief |

Tools needed: LinkedIn automation (Heyreach or Expandi), calling tool (Salesfinity or Nooks)

---

### Dept 8 — Finance & Revenue `Lukas`

| | Name | Status | Notes |
|---|---|---|---|
| Skill | `SKILL_RevenueReport` | ○ | Monthly: MRR per client, total revenue, overdue invoices |
| Skill | `SKILL_PipelineValue` | ○ | Active M&A deals × commission rate = projected revenue |

---

### Dept 9 — Sales / Agency Growth `Lukas`

| | Name | Status | Notes |
|---|---|---|---|
| Skill | `SKILL_SalesCallPrep` | ○ | Research prospect firm: M&A activity, team, focus, pain points |
| Skill | `SKILL_ProposalDraft` | ○ | After discovery call: scope, expected output, pricing, case study selection |

---

## Build Phases

### Phase 1 — Close Revenue Leaks `Weeks 1–2`

Stop leads falling through the cracks. Automate follow-ups. Give the team morning context.

| Deliverable | Owner | Status |
|---|---|---|
| Auto-reply processor with intent + FU sequence assignment | Lukas | ✅ built |
| FU sequence structure (5-step AI-drafted, logic tree) | Lukas | ✅ built |
| Outcome tracking (`converted_at_step`, `outcome`, `fu_sequence_type`) | Lukas | ✅ built — migration pending |
| Approval mode (`fu_approval_mode`, `follow_up_drafts` table) | Lukas | ✅ built — migration pending |
| GTM Brief framework + client file template | Lukas | ✅ built |
| `SKILL_IntakeClient` updated for GTM Brief | Lukas | ✅ built |
| Run `migrations/004_follow_up_outcomes.sql` | Sunny | ○ pending |
| Build `/api/follow-ups/process` | Sunny | ○ pending |
| Set up follow-up cron (every 2h) + daily briefing cron (8am) | Sunny | ○ pending |
| Add `FATHOM_API_KEY` + `SLACK_BOT_TOKEN` to Coolify | Sunny | ○ pending |
| Get `APOLLO_API_KEY` | Sunny | ○ pending |
| Build `/api/briefing/daily` | Lukas | ○ pending |
| Write `CONTEXT_OfferLibrary.md` | Kasper | ○ pending |
| Finalize `SKILL_CampaignQA.md` | Kasper | ○ pending |
| Add `files:read` scope to Slack bot | Kasper | ○ pending |

### Phase 2 — Lead Sourcing Engine `Weeks 3–5`

Claude defines the ICP, pulls from Apollo, enriches, scores, and hands off upload-ready leads.

Apollo integration, lead scoring, email verification, ICP validation loop, `CONTEXT_LeadSourcing`, `SKILL_ICPResearch`, `SKILL_LeadEnrichment`, `SKILL_LeadScoring`, `SKILL_EmailVerification`, `SKILL_PersonalisationGen`

Owner: Sunny (routes + integrations), Kasper (ICP definitions per client)

### Phase 3 — Campaign Intelligence `Weeks 6–8`

Claude monitors every campaign automatically, proposes improvements, and can build a new campaign from scratch.

`/api/campaigns/health`, `/api/campaigns/improve`, `/api/campaigns/create`, `SKILL_CampaignMonitor`, `SKILL_CampaignImprove`, `SKILL_NewCampaign`, `SKILL_VariantRefreshAuto`, `SKILL_OfferOptimization`, `CONTEXT_OfferLibrary` populated

Owner: Lukas (AI logic), Kasper (approval + content), Sunny (routes)

### Phase 4 — CRM & Pipeline `Weeks 9–12`

Every seller, buyer, and deal lives in the system. Nurture sequences run automatically.

`crm_deals`, `crm_buyers` tables, `/api/crm/pipeline`, `/api/crm/deals`, `/api/crm/nurture/process`, `SKILL_NurtureReEngage`, `SKILL_DealPipeline`, `SKILL_BuyerDatabase`, `SKILL_BuyerMatching`, `SKILL_TeaserDelivery`

Owner: Lukas

### Phase 5 — Client Management & Reporting `Weeks 13–16`

Every client gets a weekly report automatically. Biweekly calls are prepared by Claude.

`/api/reports/client/[slug]`, `/api/reports/weekly`, `SKILL_BiweeklyPrep`, `SKILL_ClientReport`, `SKILL_ClientHealthScore`, `SKILL_MeetingActionItems`, `SKILL_OnboardingMilestones`

Owner: Lukas

### Phase 6 — Multi-Channel `Weeks 17–20+`

LinkedIn outreach. Cold calling. Paid ads lead capture. Same client context, new delivery channels.

Prerequisites: LinkedIn automation tool selected (Heyreach/Expandi), calling tool selected (Salesfinity/Nooks)

---

## Automated Monitors

Run continuously from Phase 1 onwards.

| Monitor | Schedule | Route | What it does |
|---|---|---|---|
| Follow-up processing | Every 2 hours | `/api/follow-ups/process` | FUs due → draft → approval check → send or stage |
| Daily briefing | 8:00 AM weekdays | `/api/briefing/daily` | Urgent replies, FUs due, below-KPI campaigns, today's meetings |
| Fathom sync | Midnight daily | `/api/fathom/sync` | Meeting summaries → client files + internal log |
| Campaign health check | Monday 7:00 AM | `/api/campaigns/health` | All campaigns through diagnostic logic tree |
| Deliverability audit | Monday 7:00 AM | `/api/deliverability/check` | Bounce rate, blacklist, spam rate per sending domain |
| ICP validation | Every 500 sends | triggered | Interested rate by segment → update ICP in client file |
| Offer optimization | Every 500 sends | triggered | Reply rate by hook/angle → lock winners into offer library |
| Nurture re-engagement | 9:00 AM daily | `/api/crm/nurture/process` | CRM contacts due for re-engagement |

---

## API Routes

### Built

| Route | Method | What it does |
|---|---|---|
| `/api/webhook/[workspace]` | POST | EmailBison webhook receiver per workspace slug |
| `/api/webhook/calendly` | POST | Calendly booking webhook |
| `/api/auto-reply` | POST | Auto-reply processor — intent, sequence assignment, send or escalate |
| `/api/analyze` | POST | Claude Haiku reply analysis — cached in `replies.ai_analysis` |
| `/api/replies` | GET/PATCH | Fetch and update replies |
| `/api/send-reply` | POST | Proxy reply to EmailBison |
| `/api/templates` | GET | Fetch reply templates from EmailBison |
| `/api/dashboard` | GET | Aggregated dashboard data |
| `/api/calls` | GET/POST/PATCH | Call booking and status updates |
| `/api/calendly/slots` | GET | Fetch available Calendly slots |
| `/api/calendly/book` | POST | Create Calendly scheduling link |
| `/api/meetings` | GET | Meetings list |
| `/api/emailbison/campaigns` | GET | List campaigns for a workspace |
| `/api/emailbison/campaigns/[id]/sequence-steps` | GET/PUT | Read and push sequence steps |
| `/api/variant-refresh` | GET | List pending variant refreshes |
| `/api/variant-refresh/generate` | POST | Generate refresh copy for a variant |
| `/api/variant-refresh/approve` | POST | Approve and push a refreshed variant |
| `/api/variant-refresh/reject` | POST | Reject a refreshed variant |
| `/api/account-monitor` | GET | Account health monitor |
| `/api/lead-monitoring` | GET | Lead capacity check per campaign |
| `/api/fathom/sync` | POST | Fathom meetings → client files + internal log |

### To Build

| Route | Method | What it does | Phase |
|---|---|---|---|
| `/api/follow-ups/process` | POST | FUs due → draft via Claude → approval check → send or stage to `follow_up_drafts` | 1 |
| `/api/follow-ups/due` | GET | List all leads with FUs due | 1 |
| `/api/briefing/daily` | POST | Generate + post morning Slack briefing | 1 |
| `/api/crm/contacts` | POST | Create/update a CRM contact | 1 |
| `/api/apollo/search` | POST | Execute Apollo People Search query | 2 |
| `/api/apollo/enrich` | POST | Enrich contact list with company data | 2 |
| `/api/leads/score` | POST | Score and filter a lead list against ICP criteria | 2 |
| `/api/leads/verify` | POST | Validate email addresses before upload | 2 |
| `/api/campaigns/health` | GET | All campaigns: reply rate, interested rate, bounce rate, diagnostic | 3 |
| `/api/campaigns/improve` | POST | Diagnose + propose changes for one campaign | 3 |
| `/api/campaigns/create` | POST | Full campaign creation: brief → script → EmailBison | 3 |
| `/api/campaigns/segment-performance` | GET | Reply/interested rate by title/industry/geography | 3 |
| `/api/deliverability/check` | GET | Sender health check across all domains | 3 |
| `/api/crm/pipeline` | GET | Deal pipeline view across all clients | 4 |
| `/api/crm/deals` | POST | Create/update a deal record | 4 |
| `/api/crm/buyers` | POST | Add/update buyer profile | 4 |
| `/api/crm/nurture/process` | POST | Process all nurture contacts due for re-engagement | 4 |
| `/api/reports/client/[slug]` | GET | Full performance data for one client | 5 |
| `/api/reports/weekly` | GET | Company-wide weekly summary | 5 |
| `/api/slack/huddle-sync` | POST | Slack huddle notes → client files — blocked on `files:read` scope | — |

---

## Database Tables

### Built

| Table | Key columns |
|---|---|
| `workspaces` | id, slug, email_bison_api_key, email_bison_instance_url, **fu_approval_mode** (migration 004) |
| `replies` | id, workspace_slug, email_bison_reply_id, lead_email, lead_name, lead_company, lead_title, campaign, subject, message, received_at, status, interested, meeting_booked, ai_analysis (JSONB) |
| `follow_ups` | id, reply_id, workspace_slug, lead_name, lead_email, fu_step, total_emails, **fu_sequence_type**, last_fu_sent_at, next_fu_due, meeting_booked, **converted_at_step**, **outcome** (migration 004) |
| `follow_up_drafts` | id, follow_up_id, reply_id, workspace_slug, lead_name, lead_email, fu_step, subject, body, status (pending/approved/rejected/sent), slack_ts, created_at, reviewed_at, reviewed_by, sent_at (migration 004) |
| `calls` | id, reply_id, workspace_slug, lead_email, scheduled_at, status, outcome, source (manual/calendly) |
| `emails_sent` | id, workspace_slug, lead_email, campaign_name, sender_email, sequence_step, sent_at |
| `email_opens` | id, workspace_slug, lead_email, campaign_name, opened_at |
| `email_bounces` | id, workspace_slug, lead_email, campaign_name, bounce_type, bounced_at |
| `sent_emails` | id, reply_id, workspace_slug, lead_email, email_type, subject, body, sent_at |
| `fathom_synced_meetings` | recording_id, meeting_title, meeting_type, client_slug, meeting_date, synced_at |

**Pending migration:** `migrations/004_follow_up_outcomes.sql` — adds bold columns above, creates `follow_up_drafts` table. Run before deploying the FU processor.

### To Build

| Table | Key columns | Phase |
|---|---|---|
| `crm_contacts` | id, workspace_slug, lead_email, lead_name, lead_company, status, source_reply_id, future_contact_date, notes, created_at | 1 |
| `crm_deals` | id, workspace_slug, company_name, sector, revenue, ebitda, stage, assigned_client, created_at | 4 |
| `crm_buyers` | id, firm_name, contact_email, mandate_sectors, deal_size_min, deal_size_max, geography, status | 4 |
| `client_billing` | id, workspace_slug, monthly_retainer, billing_day, last_paid_date, notes | 8 |

---

## Environment Variables

| Variable | Purpose | Status |
|---|---|---|
| `DATABASE_URL` | PostgreSQL on Hetzner | ✅ set |
| `ANTHROPIC_API_KEY` | Claude API for all AI features | ✅ set — confirm in Coolify |
| `SLACK_BOT_TOKEN` | Slack notifications + future huddle sync | ✅ set — confirm in Coolify |
| `FATHOM_API_KEY` | Fathom meeting sync | ✅ set — needs Coolify |
| `CALENDLY_TOKEN` | Calendly slot fetching | ✅ set |
| `EMAILBISON_BASE_URL` | EmailBison instance base URL | ✅ set |
| `APOLLO_API_KEY` | Lead sourcing + enrichment | ❌ missing — Sunny to add |
| `ZEROBOUNCE_API_KEY` | Email verification | ❌ future |

---

## AI Models

| Model | Used for |
|---|---|
| `claude-haiku-4-5-20251001` | Reply analysis, meeting summaries, high-volume classification |
| `claude-sonnet-4-6` | Auto-reply drafting, FU drafting, complex reasoning, skill execution |

**Caching rule:** Always cache AI results in the DB. Check cache before every API call. Never re-analyze the same input twice.

---

## Key Libraries

| File | What it does |
|---|---|
| `lib/db.ts` | pg Pool singleton — DATABASE_URL, ssl:false, max:10 |
| `lib/ai-analysis.ts` | Client helper — calls `/api/analyze`, returns AIAnalysis |
| `lib/calendly.ts` | Calendly API wrapper (getCalendlyUser, getEventTypes, getAvailableSlots) |
| `lib/fathom.ts` | Fathom API types + utilities (fetchMeetings, compressTranscript, matchClientSlug) |
| `lib/utils.ts` | timeAgo, getInitials, applyTemplate, buildEmailBisonUrl |

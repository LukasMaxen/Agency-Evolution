# Maxen Partners — Master Automation Roadmap

**Team:** Lukas (AI/ops), Kasper (campaigns), Sunny (tech + lead sourcing)
**Goal:** Claude Code runs every repeatable workflow in the company end-to-end.

---

## The Three Pillars (Everything We Build Serves These)

| Pillar | What it means | How we measure it |
|---|---|---|
| **Deliverability** | Message lands in inbox, looks real, sender is healthy | Bounce rate <3%, spam rate <0.1%, open rate vs. baseline |
| **Targeting** | Right person — industry, title, company size, geography | Interested rate by segment; ICP sharpens every 500 sends |
| **Offer** | Right message — hook, value prop, CTA, PMF fit | Reply rate by variant; winning copy locked into offer library |

Every skill, route, and automation we build feeds one of these three pillars or operates the pipeline around them.

---

## Master Structure

### What Already Exists

**Infrastructure (built)**
- Reply dashboard (MasterInbox, ReplyDashboard, ReplyDetail)
- Auto-reply processor with Slack notifications (`/api/auto-reply`)
- EmailBison webhook receiver (`/api/webhook/[workspace]`)
- Variant refresh monitor + approval UI
- Campaign sequence push (`/api/emailbison/campaigns/[id]/sequence-steps`)
- Lead monitoring / capacity check
- Calendly integration (slots, booking, webhook)
- Fathom meeting sync → client files + internal log (`/api/fathom/sync`)
- Account monitor (`/api/account-monitor`)

**Skills (built)**
- `SKILL_WriteScript` — writes 3-step cold email sequences
- `SKILL_CampaignQA` — pre-launch checklist
- `SKILL_LeadMonitoring` — campaign capacity check
- `SKILL_Reply-Management` — reply drafting
- `SKILL_IntakeClient` — new client interview
- `SKILL_OnboardClient` — full onboarding SOP
- `SKILL_FileRouter` — content routing

**Context docs (built)**
- `CONTEXT_Campaign` — global campaign rules
- `CONTEXT_Replies` — global reply rules
- `CONTEXT_MaxenPartners` — company positioning

---

### Department Map (Full Build Target)

#### Dept 1 — Cold Email Campaigns `(Owner: Kasper)`
Writes, monitors, improves, and refreshes all campaigns.

| | Name | Status |
|---|---|---|
| Context | `CONTEXT_Campaign.md` | ✅ exists |
| Context | `CONTEXT_OfferLibrary.md` | 🔲 build — proven hooks, ranked angles, what doesn't work, by industry |
| Skill | `SKILL_WriteScript` | ✅ exists |
| Skill | `SKILL_CampaignQA` | ✅ exists |
| Skill | `SKILL_CampaignMonitor` | 🔲 build — daily health check, flags below-KPI campaigns |
| Skill | `SKILL_CampaignImprove` | 🔲 build — diagnoses underperformer, proposes line-level changes |
| Skill | `SKILL_NewCampaign` | 🔲 build — end-to-end: brief → script → QA → push live |
| Skill | `SKILL_OfferDevelopment` | 🔲 build — new offer angle from client brief: hooks, proof points, CTAs |
| Skill | `SKILL_OfferOptimization` | 🔲 build — after 500 sends: variant analysis, improvement recommendations |
| Skill | `SKILL_DeliverabilityAudit` | 🔲 build — weekly sender health: bounce rate, blacklist, spam rate per domain |
| Skill | `SKILL_VariantRefreshAuto` | 🔲 build — detects threshold hits, generates refresh copy, posts for approval |

---

#### Dept 2 — Lead Sourcing `(Owner: Sunny + Kasper)`
Defines the ICP, finds leads, enriches and scores them.

| | Name | Status |
|---|---|---|
| Context | `CONTEXT_LeadSourcing.md` | 🔲 build — ICP process, Apollo search logic, title batches by industry |
| Skill | `SKILL_ICPResearch` | 🔲 build — defines ICP: sectors, titles, size, geo, Boolean strings |
| Skill | `SKILL_ApolloSearch` | 🔲 build — executes Apollo query, handles pagination, deduplication |
| Skill | `SKILL_LeadEnrichment` | 🔲 build — enriches contacts: revenue, news, LinkedIn, personalisation fields |
| Skill | `SKILL_LeadScoring` | 🔲 build — scores each lead 1–10 vs. ICP, filters disqualifiers |
| Skill | `SKILL_EmailVerification` | 🔲 build — validates list before upload, removes invalid/risky/duplicate |
| Skill | `SKILL_PersonalisationGen` | 🔲 build — generates opening line per lead using company context/title/city |
| Skill | `SKILL_TitleResearch` | 🔲 build — best titles to target per ICP; tests variations, ranks by reply rate |
| Skill | `SKILL_ICPValidation` | 🔲 build — after 500 sends: which segments convert best → update ICP definition |

---

#### Dept 3 — Reply Management `(Owner: Lukas)`
Handles every inbound reply, follow-up, and nurture touch automatically.

| | Name | Status |
|---|---|---|
| Context | `CONTEXT_Replies.md` | ✅ exists |
| Skill | `SKILL_Reply-Management` | ✅ exists |
| Skill | `SKILL_LeadMonitoring` | ✅ exists |
| Skill | `SKILL_FUSequenceAuto` | 🔲 build — cron-driven: checks `follow_ups` table, sends due FU step |
| Skill | `SKILL_NurtureCapture` | 🔲 build — detects "reach back in X months" in reply, writes to CRM with future_contact_date |
| Skill | `SKILL_TeaserDelivery` | 🔲 build — detects "send teaser/NDA" intent, auto-sends document, logs on deal |

---

#### Dept 4 — CRM & Pipeline `(Owner: Lukas)`
Tracks every seller, buyer, and deal that enters the pipeline — including long-tail nurture.

| | Name | Status |
|---|---|---|
| Context | `CONTEXT_CRM.md` | 🔲 build — CRM structure: seller nurture, deal stages, buyer mandates |
| Skill | `SKILL_NurtureReEngage` | 🔲 build — cron: finds contacts due for re-engagement today, drafts and sends |
| Skill | `SKILL_DealPipeline` | 🔲 build — create/update deal stages (interest → NDA → teaser → CIM → offer → closed) |
| Skill | `SKILL_BuyerDatabase` | 🔲 build — add/update buyer profiles: mandates, sectors, deal size, geography |
| Skill | `SKILL_BuyerMatching` | 🔲 build — given a new sell-side mandate, surface top buyers from DB by fit score |

**New DB tables needed:** `crm_contacts`, `crm_deals`, `crm_buyers`

---

#### Dept 5 — Client Management `(Owner: Lukas)`
Prepares for calls, writes reports, flags relationship risks.

| | Name | Status |
|---|---|---|
| Skill | `SKILL_BiweeklyPrep` | 🔲 build — before each client call: campaign stats, reply themes, open action items |
| Skill | `SKILL_ClientReport` | 🔲 build — weekly client-facing report: leads contacted, reply rate, meetings, pipeline |
| Skill | `SKILL_ClientHealthScore` | 🔲 build — aggregate score per client: performance + activity + pipeline + renewal |
| Skill | `SKILL_MeetingActionItems` | 🔲 build — after Fathom sync: extracts action items, adds checklist to client file |
| Skill | `SKILL_OnboardingMilestones` | 🔲 build — tracks contract signed → first send live with milestone checklist |

---

#### Dept 6 — Operations & Intelligence `(Owner: Lukas)`
Morning briefing, weekly review, team alignment, Slack sync.

| | Name | Status |
|---|---|---|
| Skill | `SKILL_DailyBriefing` | 🔲 build — 8am Slack post: urgent replies, campaigns below KPI, FUs due, meetings |
| Skill | `SKILL_WeeklyReview` | 🔲 build — Friday wrap: performance vs. prior week, what changed, what's next |
| Skill | `SKILL_SlackHuddleSync` | 🔲 blocked — needs `files:read` scope from Kasper first |
| Skill | `SKILL_FileRouter` | ✅ exists |
| Skill | `SKILL_IntakeClient` | ✅ exists |
| Skill | `SKILL_OnboardClient` | ✅ exists |

---

#### Dept 7 — Multi-Channel `(Owner: Kasper + Sunny — future activation)`
Same ICP, same offer, different channel. Client files carry context across channels.

| | Name | Status |
|---|---|---|
| Context | `CONTEXT_LinkedIn.md` | 🔲 scaffold — LinkedIn-specific rules, acceptance rate benchmarks, connection norms |
| Context | `CONTEXT_ColdCalling.md` | 🔲 scaffold — call script structure, objection handling norms, voicemail rules |
| Skill | `SKILL_LinkedInScript` | 🔲 build — connection request + 3-step follow-up message sequences |
| Skill | `SKILL_LinkedInICP` | 🔲 build — Sales Navigator targeting: industries, titles, seniority, company size |
| Skill | `SKILL_ColdCallScript` | 🔲 build — call script + objection handling guide per campaign |
| Skill | `SKILL_AdCopy` | 🔲 future — Meta/LinkedIn ad copy + lead form questions from client brief |

**Tool integrations needed:** LinkedIn automation (Heyreach/Expandi), Calling tool (Salesfinity/Nooks)

---

#### Dept 8 — Finance & Revenue `(Owner: Lukas)`
Tracks MRR, invoices, and pipeline value.

| | Name | Status |
|---|---|---|
| Skill | `SKILL_RevenueReport` | 🔲 build — monthly: MRR per client, total revenue, overdue invoices |
| Skill | `SKILL_PipelineValue` | 🔲 build — active M&A deals × commission rate = projected revenue |

**New DB table needed:** `client_billing`

---

#### Dept 9 — Sales / Agency Growth `(Owner: Lukas)`
Maxen Partners' own pipeline — prospect research, proposals, case studies.

| | Name | Status |
|---|---|---|
| Skill | `SKILL_SalesCallPrep` | 🔲 build — research prospect firm: M&A activity, team, focus, pain points |
| Skill | `SKILL_ProposalDraft` | 🔲 build — after discovery call: scope, expected output, pricing, case study selection |

---

## API Routes — Full Target List

| Route | What it does | Status |
|---|---|---|
| `POST /api/auto-reply` | Auto-reply processor | ✅ exists |
| `POST /api/fathom/sync` | Fathom meeting → client files | ✅ exists |
| `GET /api/campaigns/health` | All campaigns: reply rate, interested rate, bounce rate | 🔲 build |
| `POST /api/campaigns/improve` | Diagnose + propose changes for one campaign | 🔲 build |
| `POST /api/campaigns/create` | Full campaign creation: brief → script → EmailBison | 🔲 build |
| `GET /api/deliverability/check` | Sender health check across all domains | 🔲 build |
| `GET /api/campaigns/segment-performance` | Reply/interested rate by title/industry/geography | 🔲 build |
| `POST /api/apollo/search` | Execute Apollo People Search query | 🔲 build |
| `POST /api/apollo/enrich` | Enrich contact list with company data | 🔲 build |
| `POST /api/leads/score` | Score + filter a lead list against ICP criteria | 🔲 build |
| `POST /api/follow-ups/process` | Send all FU emails due today | 🔲 build |
| `GET /api/follow-ups/due` | List all leads with FUs due | 🔲 build |
| `POST /api/briefing/daily` | Generate + post morning Slack briefing | 🔲 build |
| `POST /api/crm/contacts` | Create/update a CRM contact (sellers, buyers, nurture) | 🔲 build |
| `GET /api/crm/pipeline` | Deal pipeline view across all clients | 🔲 build |
| `POST /api/crm/deals` | Create/update a deal record | 🔲 build |
| `POST /api/crm/nurture/process` | Process all nurture contacts due for re-engagement | 🔲 build |
| `GET /api/reports/client/[slug]` | Full performance data for one client | 🔲 build |
| `GET /api/reports/weekly` | Company-wide weekly summary | 🔲 build |
| `POST /api/slack/huddle-sync` | Slack huddle notes → client files (blocked) | 🔲 blocked |

---

## Cron Jobs — Full Target List

| Job | Schedule | Route |
|---|---|---|
| Daily briefing | 8:00 AM weekdays | `/api/briefing/daily` |
| Follow-up processing | Every 2 hours | `/api/follow-ups/process` |
| Nurture re-engagement | 9:00 AM daily | `/api/crm/nurture/process` |
| Campaign health check | Monday 7:00 AM | `/api/campaigns/health` |
| Deliverability audit | Monday 7:00 AM | `/api/deliverability/check` |
| Fathom sync | Midnight daily | `/api/fathom/sync` |

---

## Environment Variables Needed

| Var | Who gets it | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | Sunny adds to Coolify | ✅ in .env.local |
| `SLACK_BOT_TOKEN` | Sunny adds to Coolify | ✅ in .env.local |
| `FATHOM_API_KEY` | Sunny adds to Coolify | ✅ in .env.local — needs Coolify |
| `APOLLO_API_KEY` | Sunny gets from Apollo account | 🔲 missing |
| `ZEROBOUNCE_API_KEY` | Evaluate — email verification | 🔲 future |

---

## Phases

---

### Phase 1 — Close Revenue Leaks (Weeks 1–2)

**Objective:** Stop leads falling through the cracks. Automate follow-ups. Give the team morning context. Seed the CRM.

**What gets built:**
- Follow-up automation — no more leads going cold after first reply
- Nurture capture — "reach back in 6 months" leads enter CRM instead of disappearing
- Daily briefing — team knows what to do each morning without manual check
- Offer library seed — document what's working now before it's forgotten
- Deliverability standards — baseline check on all sending domains

---

#### Lukas — Phase 1 Tasks

| Task | What to do |
|---|---|
| Modify auto-reply processor | Add `"nurture"` intent detection — when lead says "reach back in X months", write to `crm_contacts` table with `future_contact_date`. Update `processAutoReply()` in `app/api/auto-reply/processor.ts` |
| Create `crm_contacts` table | Run SQL migration: id, workspace_slug, lead_email, lead_name, lead_company, status, source_reply_id, future_contact_date, notes, created_at |
| Build `/api/briefing/daily` | Aggregates: replies with status='new', FUs due today, campaigns flagged below KPI, today's Fathom meetings. Posts formatted Slack message to #team-chat |
| Write `SKILL_DailyBriefing.md` | Prompt + structure for the morning briefing skill |
| Write `CONTEXT_CRM.md` | Defines CRM structure: what a seller contact is, what a deal is, stage definitions, how to use the buyer database |

---

#### Kasper — Phase 1 Tasks

| Task | What to do |
|---|---|
| Add Slack `files:read` scope | Go to api.slack.com/apps → Claude Bot → OAuth & Permissions → Bot Token Scopes → add `files:read` → reinstall app → share new token with Lukas. Unblocks Slack huddle sync. |
| Write `CONTEXT_OfferLibrary.md` | Fill in for all active clients: 3–5 hooks that have worked, 2–3 that haven't, best CTAs, best subject lines, proven P.S. lines. This is your IP — capture it now. |
| Campaign performance review | For each active campaign: note current reply rate, interested rate, and flag any that have been running 30+ days below 5% reply rate. List goes to Lukas for Phase 2 CampaignMonitor build. |

---

#### Sunny — Phase 1 Tasks

| Task | What to do |
|---|---|
| Add `FATHOM_API_KEY` to Coolify | Add env var to production — Fathom sync only works locally right now |
| Add `SLACK_BOT_TOKEN` to Coolify | Confirm it's set in production (Slack notifications may already work) |
| Get `APOLLO_API_KEY` | Log into Apollo account, generate API key, add to Coolify + `.env.local` |
| Build `/api/follow-ups/process` | Query `follow_ups` table for `next_fu_due <= NOW()` and `meeting_booked = false`. For each lead, read client file, draft correct FU step via Claude, send via EmailBison. Mark sent, update `next_fu_due`. |
| Build `/api/apollo/search` | Accepts a query object (titles, industries, locations, company size). Calls Apollo People Search API. Returns paginated contact list. Handles auth via `APOLLO_API_KEY`. |
| Set up cron jobs in Coolify | Configure: follow-up processing (every 2h), daily briefing (8am weekdays), Fathom sync (midnight daily) |

---

### Phase 2 — Lead Sourcing Engine (Weeks 3–5)

**Objective:** Claude can define an ICP, pull a list from Apollo, enrich it, score it, and hand off upload-ready leads. End the manual lead sourcing process.

**What gets built:** Apollo enrichment, lead scoring, email verification, ICP validation loop, `CONTEXT_LeadSourcing.md`, `SKILL_ICPResearch`, `SKILL_LeadEnrichment`, `SKILL_LeadScoring`, `SKILL_EmailVerification`, `SKILL_PersonalisationGen`

**Owner:** Sunny (routes + integrations), Kasper (ICP definitions per client)

---

### Phase 3 — Campaign Intelligence (Weeks 6–8)

**Objective:** Claude monitors every campaign automatically, proposes improvements, and can build a new campaign from scratch.

**What gets built:** `/api/campaigns/health`, `/api/campaigns/improve`, `/api/campaigns/create`, `SKILL_CampaignMonitor`, `SKILL_CampaignImprove`, `SKILL_NewCampaign`, `SKILL_VariantRefreshAuto`, `SKILL_OfferOptimization`, `CONTEXT_OfferLibrary` populated

**Owner:** Lukas (AI logic), Kasper (approval + content), Sunny (routes)

---

### Phase 4 — CRM & Pipeline (Weeks 9–12)

**Objective:** Every seller, buyer, and deal lives in the system. Nurture sequences run automatically. Buyers get matched to new mandates.

**What gets built:** `crm_deals`, `crm_buyers` tables, `/api/crm/pipeline`, `/api/crm/deals`, `/api/crm/nurture/process`, `SKILL_NurtureReEngage`, `SKILL_DealPipeline`, `SKILL_BuyerDatabase`, `SKILL_BuyerMatching`, `SKILL_TeaserDelivery`

**Owner:** Lukas

---

### Phase 5 — Client Management & Reporting (Weeks 13–16)

**Objective:** Every client gets a weekly report automatically. Biweekly calls are prepared by Claude. Client health is scored and at-risk clients are flagged before they churn.

**What gets built:** `/api/reports/client/[slug]`, `/api/reports/weekly`, `SKILL_BiweeklyPrep`, `SKILL_ClientReport`, `SKILL_ClientHealthScore`, `SKILL_MeetingActionItems`, `SKILL_OnboardingMilestones`

**Owner:** Lukas

---

### Phase 6 — Multi-Channel (Weeks 17–20+)

**Objective:** Launch LinkedIn outreach. Stand up cold calling. Scaffold paid ads lead capture. Same client context, same offer — new delivery channels.

**What gets built:** `CONTEXT_LinkedIn.md`, `CONTEXT_ColdCalling.md`, `SKILL_LinkedInScript`, `SKILL_LinkedInICP`, `SKILL_ColdCallScript`, LinkedIn automation tool integration, calling tool integration

**Owner:** Kasper (scripts + ICP), Sunny (tool integrations)

**Prerequisites:** LinkedIn automation tool selected (Heyreach/Expandi), calling tool selected (Salesfinity/Nooks)

---

### Ongoing — Three Pillars Monitoring (runs throughout all phases)

| Monitor | Trigger | What it does |
|---|---|---|
| Deliverability audit | Every Monday | Checks all sending domains: bounce rate, blacklist, spam rate. Posts to Slack. |
| ICP validation | Every 500 sends per campaign | Compares interested rate by segment. Surfaces best and worst performers. Updates ICP. |
| Offer optimization | Every 500 sends per variant | Compares reply rate by hook/angle. Flags losers, locks in winners to offer library. |

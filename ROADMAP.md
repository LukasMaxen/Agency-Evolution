# Maxen Partners — Technical Roadmap

The full department structure, skills, and phase plan live in SYSTEM-OVERVIEW.md.
The Phase 1 team action plan lives in PHASE-1.md.
This file is the technical reference: API routes, DB tables, cron jobs, env vars, and the learning architecture.

---

## How the System Learns

Every skill either reads from what was learned before, writes back what it just learned, or both.
Context files and client files are the brain — they compound over time.

    RULE: Every skill that produces meaningful output must write findings back
          into the relevant context file or client file before it completes.

    Campaign outcomes  →  ICP definitions updated in client file (SKILL_ICPValidation)
                          Winning hooks locked into CONTEXT_OfferLibrary (SKILL_OfferOptimization)

    Reply data         →  Human corrections written as new rules to client file (SKILL_ReplyTraining)
                          Nurture dates written to crm_contacts (SKILL_NurtureCapture)

    Meetings           →  Summaries, feedback, action items written to client file (Fathom sync)

    Monitor flags      →  Diagnosis written to client file, fix queued (SKILL_CampaignMonitor)

---

## API Routes

### Built

| Route | Method | What it does |
|---|---|---|
| `/api/auto-reply` | POST | Auto-reply processor — classifies intent, sends reply or escalates |
| `/api/analyze` | POST | Claude Haiku reply analysis — cached in replies.ai_analysis |
| `/api/fathom/sync` | POST | Fathom meetings → client files + internal log |
| `/api/webhook/[workspace]` | POST | EmailBison webhook receiver per workspace slug |
| `/api/webhook/calendly` | POST | Calendly booking webhook |
| `/api/replies` | GET/PATCH | Fetch and update replies |
| `/api/send-reply` | POST | Proxy reply to EmailBison |
| `/api/sent-replies` | GET | Fetch sent reply history |
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
| `/api/lead-progress` | GET | Lead progress tracking |
| `/api/sync-lead-progress` | POST | Sync lead progress data |
| `/api/campaign-lifecycle` | GET | Campaign lifecycle status |

### To Build

| Route | Method | What it does | Phase |
|---|---|---|---|
| `/api/campaigns/health` | GET | All campaigns: reply rate, interested rate, bounce rate, diagnostic | 1 |
| `/api/briefing/daily` | POST | Generate + post morning Slack briefing | 1 |
| `/api/crm/contacts` | POST | Create/update a CRM contact | 1 |
| `/api/follow-ups/process` | POST | Send all FU emails due today | 1 |
| `/api/follow-ups/due` | GET | List all leads with FUs due | 1 |
| `/api/apollo/search` | POST | Execute Apollo People Search query | 1 |
| `/api/apollo/enrich` | POST | Enrich contact list with company data | 2 |
| `/api/leads/score` | POST | Score and filter a lead list against ICP | 2 |
| `/api/leads/verify` | POST | Validate email addresses | 2 |
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
| `/api/slack/huddle-sync` | POST | Slack huddle notes → client files (blocked on files:read scope) | — |

---

## Database Tables

### Built

| Table | Key columns |
|---|---|
| `workspaces` | id, slug, email_bison_api_key, email_bison_instance_url |
| `replies` | id, workspace_slug, email_bison_reply_id, lead_email, lead_name, lead_company, lead_title, campaign, subject, message, received_at, status, interested, meeting_booked, ai_analysis (JSONB) |
| `follow_ups` | id, reply_id, workspace_slug, lead_name, lead_email, fu_step, total_emails, last_fu_sent_at, next_fu_due, meeting_booked |
| `calls` | id, reply_id, workspace_slug, lead_email, scheduled_at, status, outcome, source (manual/calendly) |
| `emails_sent` | id, workspace_slug, lead_email, campaign_name, sender_email, sequence_step, sent_at |
| `email_opens` | id, workspace_slug, lead_email, campaign_name, opened_at |
| `email_bounces` | id, workspace_slug, lead_email, campaign_name, bounce_type, bounced_at |
| `sent_emails` | id, reply_id, workspace_slug, lead_email, email_type, subject, body, sent_at |
| `fathom_synced_meetings` | recording_id, meeting_title, meeting_type, client_slug, meeting_date, synced_at |

### To Build

| Table | Key columns | Phase |
|---|---|---|
| `crm_contacts` | id, workspace_slug, lead_email, lead_name, lead_company, status, source_reply_id, future_contact_date, notes, created_at | 1 |
| `crm_deals` | id, workspace_slug, company_name, sector, revenue, ebitda, stage, assigned_client, created_at | 4 |
| `crm_buyers` | id, firm_name, contact_email, mandate_sectors, deal_size_min, deal_size_max, geography, status | 4 |
| `client_billing` | id, workspace_slug, monthly_retainer, billing_day, last_paid_date, notes | 8 |

---

## Cron Jobs

| Job | Schedule | Route | Phase |
|---|---|---|---|
| Follow-up processing | Every 2 hours | `/api/follow-ups/process` | 1 |
| Daily briefing | 8:00 AM weekdays | `/api/briefing/daily` | 1 |
| Fathom sync | Midnight daily | `/api/fathom/sync` | built |
| Campaign health check | Monday 7:00 AM | `/api/campaigns/health` | 1 |
| Deliverability audit | Monday 7:00 AM | `/api/deliverability/check` | 3 |
| Nurture re-engagement | 9:00 AM daily | `/api/crm/nurture/process` | 4 |

---

## Environment Variables

| Variable | Purpose | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API for all AI features | ✅ set — needs Coolify |
| `SLACK_BOT_TOKEN` | Slack notifications + future huddle sync | ✅ set — confirm in Coolify |
| `FATHOM_API_KEY` | Fathom meeting sync | ✅ set — needs Coolify |
| `DATABASE_URL` | PostgreSQL on Hetzner | ✅ set |
| `APOLLO_API_KEY` | Lead sourcing + enrichment | ❌ missing — Sunny to add |
| `ZEROBOUNCE_API_KEY` | Email verification | ❌ future |

---

## Key Libraries

| File | What it does |
|---|---|
| `lib/db.ts` | pg Pool singleton — DATABASE_URL, ssl:false, max:10 |
| `lib/fathom.ts` | Fathom API types + utilities (fetchMeetings, compressTranscript, matchClientSlug) |
| `lib/ai-analysis.ts` | Client helper — calls /api/analyze, returns AIAnalysis |
| `lib/calendly.ts` | Calendly API wrapper (getCalendlyUser, getEventTypes, getAvailableSlots) |
| `lib/utils.ts` | timeAgo, getInitials, applyTemplate, buildEmailBisonUrl |

---

## AI Models in Use

| Model | Used for |
|---|---|
| `claude-haiku-4-5-20251001` | Reply analysis, meeting summaries, high-volume tasks |
| `claude-sonnet-4-6` | Auto-reply drafting, complex reasoning, skill execution |

**Caching rule:** Always cache AI results in the DB. Check cache before every API call. Never re-analyze the same input twice.

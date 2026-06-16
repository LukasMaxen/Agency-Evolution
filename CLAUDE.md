# Maxen Partners — AI Reply Desk — CLAUDE.md

Centralized reply management dashboard and Business OS for **Maxen Partners**, a full-funnel origination system for M&A intermediaries and Private Equity buyers. Managing 15+ EmailBison workspaces for cold outreach clients.

**Team:** Lukas Maxen (founder, AI/ops), Kasper Zacho (campaigns), Sunny Newar (tech + lead sourcing)

---

## Communication Rules (always)

1. Never use em dashes (—) or en dashes (–) anywhere. Use commas, periods, parentheses, or line breaks instead. Applies to all chat responses, all code comments, all docs, all email copy.
2. Always end every message with a clear next step. State exactly what the user should do next, or what will happen next.

---

## Client Files

Every client has a single file in `clients/[slug].md` — the source of truth for their offer, ICP, campaign strategy, reply guidelines, FU templates, Slack/email history, and campaign notes.

**Before any client task:** read `clients/[client-slug].md` first.

To onboard a new client: follow `1. Departments/operations/SKILL_OnboardClient.md`.

---

## Common Workflows (read the linked skill BEFORE answering)

When a user asks for any of the following, open the linked skill file FIRST and follow it end to end. Do not improvise the data source, do not write your own SQL, do not guess the output format.

| Request pattern | Skill to read first |
|---|---|
| "CSM update", "daily update", "customer success update", "numbers for yesterday/today/last week", any per-client send/reply/interested/meeting numbers request | `1. Departments/operations/SKILL_CSMUpdate.md` |
| "Onboard a new client", new client setup | `1. Departments/operations/SKILL_OnboardClient.md` |
| "Campaign QA", reviewing a campaign before launch | `1. Departments/cold email campaigns/SKILL_CampaignQA.md` |
| "Write a script", drafting cold email copy | `1. Departments/cold email campaigns/SKILL_WriteScript.md` |
| "Lead monitoring", checking sending health | `1. Departments/cold email campaigns/SKILL_LeadMonitoring.md` |

The CSM update is especially load-bearing: the numbers go into Slack and to clients. Always pull from the sources the skill specifies (EmailBison `/api/workspaces/v1.1/stats` for sends/replies/interested, Airtable for meetings). Do not query the `emails_sent` or `replies` PostgreSQL tables for the daily/weekly counts — the DB had an undercounting bug and the skill was rewritten to avoid it.

## Business OS — Department Folders

Departments contain reusable skills, context, and workflows — the HOW. Client-specific context lives in `clients/`.

| Folder | Owner | What's inside |
|---|---|---|
| `1. Departments/company/` | Lukas | Company positioning, brand context (Maxen Partners) |
| `1. Departments/leads/` | Sunny + Kasper | ICP process, list sourcing, enrichment, scoring |
| `1. Departments/cold email campaigns/` | Kasper | Strategy, scripting, EmailBison workflows, integrations |
| `1. Departments/reply-management/` | Lukas | First-response handling for inbound replies, intent classification, AI guidelines |
| `1. Departments/follow-up-management/` | Lukas | FU sequence after first response, step purposes, approval flow, outcome tracking |
| `1. Departments/operations/` | Lukas | Tech stack, git workflow, AI framework, onboarding, team |

---

## Git Workflow

For branching, PRs, code review, and team setup see `departments/operations/git-workflow.md`.

---

## Stack

- **Next.js 16** (App Router) — note: NOT Next.js 13/14. APIs and conventions may differ from training data. Check `node_modules/next/dist/docs/` before making assumptions.
- **React 19**, **TypeScript 5**, **Tailwind CSS 4**
- **PostgreSQL** via `pg` pool (no Prisma/ORM) — raw SQL queries throughout
- **Lucide React** for icons
- Deployed on **Coolify** (self-hosted); DB hosted externally (Hetzner)

---

## Environment Variables

All secrets live in `.env.local` (never committed). Required vars:

```
DATABASE_URL               # PostgreSQL connection string (ssl: false)
ANTHROPIC_API_KEY          # Used in /api/analyze — Claude Haiku for reply analysis
CALENDLY_TOKEN             # OAuth token for Calendly slot fetching
EMAILBISON_BASE_URL        # e.g. https://send.emailagencyevolution.com
AIRTABLE_API_KEY           # Personal access token used for meetings lookups in the CSM update
```

Workspace-level EmailBison credentials (`email_bison_api_key`, `email_bison_instance_url`) are stored **in the DB** (`workspaces` table), not in env vars.

A template of the required vars lives at `.env.local.example`. New team members: copy it to `.env.local` and ask Lukas for the secret values.

---

## Project Structure

```
departments/                          # Business OS — all workflows and client context
instrumentation.ts                    # Boots in-process timers on server start: auto-reply self-sweeper (60s), inbox sync (10m), weekly review, sender sync (6h)
app/
  page.tsx                          # Entry — renders <MasterInbox />
  layout.tsx                        # Root layout
  globals.css                       # Global styles
  api/
    analyze/route.ts                # POST — Claude Haiku reply analysis (on-demand, called from ReplyDetail panel)
    auto-reply/
      processor.ts                  # processAutoReply — pre-filters, Sonnet classify, draft, route to Slack #reply-approval / #manual-replies / EmailBison send / forward
      run/route.ts                  # POST — webhook self-fetch target. Sleeps until 2-min hold passes, then calls processAutoReply. Gated by AUTO_REPLY_RUN_TOKEN.
    calls/route.ts                  # GET/POST/PATCH — call booking + status updates
    calendly/
      slots/route.ts                # GET — fetch available Calendly slots
      book/route.ts                 # POST — create Calendly scheduling link
    dashboard/route.ts              # GET — aggregated dashboard data (replies, FU, calls, email stats)
    meetings/route.ts               # GET — meetings list
    replies/route.ts                # GET/PATCH — fetch/update replies
    send-reply/route.ts             # POST — proxy reply to EmailBison API
    templates/route.ts              # GET — fetch reply templates from EmailBison
    emailbison/
      campaigns/
        route.ts                    # GET — list campaigns for a workspace (?workspace=slug)
        [campaign_id]/
          sequence-steps/
            route.ts                # GET — read current sequence steps; PUT — push approved script updates
    webhook/
      [workspace]/route.ts          # POST — EmailBison webhook receiver (per workspace slug). INSERTs reply row, self-fetches /api/auto-reply/run.
      calendly/route.ts             # POST — Calendly webhook receiver

components/
  MasterInbox.tsx                   # Main UI entry — sidebar + tab layout (Inbox, Dashboard, Lead Monitoring, etc.)
  ReplyDetail.tsx                   # Right panel — message view + AI analysis + reply composer
  ReplyList.tsx                     # Left panel — inbox list + filters
  ReplyDashboard.tsx                # Legacy — superseded by MasterInbox, not rendered anywhere
  CalendlySlotPicker.tsx            # Slot picker with timezone support + demo mode fallback
  CallBookingModal.tsx              # Modal for manual call booking
  AIBadge.tsx                       # Intent/urgency badge for AI analysis results
  StatusBadge.tsx                   # new / interested / not_interested badge
  WorkspaceAvatar.tsx               # Colored avatar for workspace
  EmptyState.tsx                    # Empty state for right panel

lib/
  db.ts                             # pg Pool singleton (DATABASE_URL, ssl:false, max:10)
  ai-analysis.ts                    # Client-side helper — calls /api/analyze, returns AIAnalysis
  auto-reply-self-sweeper.ts        # 60s in-process safety net. Picks up status='new' rows the webhook trigger missed and runs processAutoReply on them.
  slack-approval.ts                 # Slack post helpers, approval card footer blocks, request signature verification
  calendly.ts                       # Calendly API wrapper (getCalendlyUser, getEventTypes, getAvailableSlots)
  dashboard-data.ts                 # TypeScript types + mock data for dashboard (DashboardReply, FollowUpLead, MeetingLead)
  mock-data.ts                      # Mock workspaces, replies, templates (used in dev/demo mode)
  utils.ts                          # timeAgo, getInitials, applyTemplate, buildEmailBisonUrl
```

---

## Database Tables

| Table | Key Columns |
|---|---|
| `workspaces` | `id`, `slug`, `email_bison_api_key`, `email_bison_instance_url` |
| `replies` | `id`, `workspace_id`, `workspace_slug`, `email_bison_reply_id`, `lead_email`, `lead_name`, `lead_company`, `lead_title`, `sender_email`, `campaign`, `subject`, `message`, `received_at`, `status`, `interested`, `meeting_booked`, `ai_analysis` (JSONB), `ai_analyzed_at` |
| `follow_ups` | `id`, `reply_id`, `workspace_slug`, `lead_name`, `lead_email`, `first_replied_at`, `fu_step`, `total_emails`, `last_fu_sent_at`, `next_fu_due`, `meeting_booked` |
| `calls` | `id`, `reply_id`, `workspace_slug`, `lead_email`, `lead_name`, `source` (manual/calendly), `scheduled_at`, `status`, `outcome`, `notes`, `is_reschedule`, `original_call_id`, `created_at`, `updated_at` |
| `emails_sent` | `id`, `workspace_slug`, `lead_email`, `lead_name`, `campaign_name`, `sender_email`, `sequence_step`, `sent_at` |
| `email_opens` | `id`, `workspace_slug`, `lead_email`, `lead_name`, `campaign_name`, `opened_at` |
| `email_bounces` | `id`, `workspace_slug`, `lead_email`, `lead_name`, `campaign_name`, `bounce_type`, `bounced_at` |
| `sent_emails` | `id`, `reply_id`, `workspace_slug`, `lead_email`, `lead_name`, `email_type`, `subject`, `body`, `sent_at` |

---

## Key Patterns & Conventions

### API Routes
- All routes use Next.js App Router (`NextRequest` / `NextResponse`)
- Dynamic params are async in Next.js 16: `const { workspace } = await context.params` — **never** destructure params synchronously
- DB queries use parameterized `pool.query(sql, [values])` — no string interpolation
- Error handling: always wrap in try/catch, return `{ error: err.message }` with appropriate status

### Database
- Pool imported from `@/lib/db` as a singleton
- `ssl: false` — direct connection to Hetzner PostgreSQL (not Supabase)
- Raw SQL only, no ORM. Use `$1, $2, ...` placeholders
- `ON CONFLICT (id) DO NOTHING` pattern used heavily for idempotent webhook inserts

### AI Analysis (`/api/analyze`)
- Uses **Claude Haiku** (`claude-haiku-4-5-20251001`) via direct Anthropic API fetch
- Results cached in `replies.ai_analysis` (JSONB) — never re-analyzes the same reply
- Returns: `{ intent, urgency, summary, suggestedTemplateId, suggestedReply }`
- Intent values: `interested_urgent | interested | needs_info | neutral | not_interested | unsubscribe`
- Urgency values: `high | medium | low`

### EmailBison Integration
- Each workspace has its own `email_bison_api_key` and `email_bison_instance_url` in DB
- Webhook endpoint: `POST /api/webhook/[workspace]` — workspace slug in URL path
- Handled events: `LEAD_REPLIED`, `CONTACT_INTERESTED`, `CONTACT_UNSUBSCRIBED`, `EMAIL_SENT`, `MANUAL_EMAIL_SENT`, `EMAIL_OPENED`, `EMAIL_BOUNCED`, `CONTACT_FIRST_EMAILED`
- Reply sending: `POST /api/send-reply` — proxies to `{instanceUrl}/api/replies/{emailBisonReplyId}/reply`
- Merge tags resolved server-side before sending: `{FIRST_NAME}`, `{LAST_NAME}`, `{COMPANY}`, `{TITLE}`, `{{first_name}}` etc.

### Calendly Integration
- Single `CALENDLY_TOKEN` env var (not per workspace)
- Slot fetcher: `GET /api/calendly/slots` — returns next 5 days, max 9 slots
- `CalendlySlotPicker` component has a demo mode fallback when the API is unavailable

### Known Bug (Recurring)
The opening `<a` tag on the "View in EmailBison" link in `ReplyDetail.tsx` gets dropped on regeneration. Fix: manually add it back. Always verify this link is intact after editing `ReplyDetail.tsx`.

---

## Common Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```

---

## Mock vs Live Data

`lib/mock-data.ts` and `lib/dashboard-data.ts` contain realistic mock data for dev/demo mode. When connecting new features, always wire through the API routes — do not import mock data directly into components intended for production.

---

## Architecture Notes

- **No auth layer** — internal tool only, no login/session management.
- **No Prisma** — migrations must be run manually as raw SQL against the PostgreSQL instance.
- **`MasterInbox.tsx`** is the main UI orchestrator (rendered by `app/page.tsx`). `ReplyDashboard.tsx` is legacy and not wired into the active route.
- Coolify → Hetzner PostgreSQL: ensure `DATABASE_URL` is set correctly in Coolify project settings and that the Hetzner firewall allows outbound connections on port 5432.

## Auto-reply path (end-to-end)

The full chain that turns an inbound reply into a Slack approval card:

1. EmailBison `LEAD_REPLIED` → `POST /api/webhook/[workspace]` → INSERT into `replies` table as `status='new'`.
2. Webhook self-fetches `POST /api/auto-reply/run?id=…&workspace=…` (gated by `AUTO_REPLY_RUN_TOKEN`) and returns 200 to EmailBison immediately.
3. `/run` sleeps until the row is 2 minutes old (dedup window for superseding replies from the same lead), then calls `processAutoReply`.
4. `processAutoReply` runs pre-filters (OOO/bounce/Mailinblack), classifies intent via Sonnet, drafts the reply, then either:
   - posts an approval card to Slack `#reply-approval` → `status='awaiting_approval'` (interested/needs_info/neutral)
   - posts to `#manual-replies` → `status='awaiting_manual'`
   - auto-sends or forwards directly → `status='replied'` or `'forwarded'` (hard closes, forward-workspaces like Hahnbeck)
   - silently closes → `status='read'` (not_interested, unsubscribe, OOO, etc.)
5. Safety net: `lib/auto-reply-self-sweeper.ts` runs every 60s in-process (started from `instrumentation.ts`) and picks up any `status='new'` row the webhook trigger missed.

Required env var: `AUTO_REPLY_RUN_TOKEN` (any random string, shared between webhook and /run inside the same Node process). If missing or mismatched, /run returns 401 and replies stall at `status='new'` until the self-sweeper picks them up.

# Agency Evolution — AI Reply Desk — CLAUDE.md

Centralized reply management dashboard built for **Agency Evolution**, a B2B lead gen agency managing 16+ EmailBison workspaces for PE/IB cold outreach clients.

---

## Client Context

For client-specific context (offers, reply styles, Calendly links, target audiences) see `skills/SKILL.md`. Read it before any task involving reply generation, follow-up templates, AI prompt tuning, or client-specific logic.

For the reply process, objection handling, and all 10 follow-up email templates per client see `skills/REPLIES.md`.

---

## Stack

- **Next.js 16** (App Router) — note: NOT Next.js 13/14. APIs and conventions may differ from training data. Check `node_modules/next/dist/docs/` before making assumptions.
- **React 19**, **TypeScript 5**, **Tailwind CSS 4**
- **PostgreSQL** via `pg` pool (no Prisma/ORM) — raw SQL queries throughout
- **Lucide React** for icons
- Deployed on **Vercel** (Hobby plan); DB hosted externally (Hetzner)

---

## Environment Variables

All secrets live in `.env.local` (never committed). Required vars:

```
DATABASE_URL               # PostgreSQL connection string (ssl: false)
ANTHROPIC_API_KEY          # Used in /api/analyze — Claude Haiku for reply analysis
CALENDLY_TOKEN             # OAuth token for Calendly slot fetching
EMAILBISON_BASE_URL        # e.g. https://send.emailagencyevolution.com
```

Workspace-level EmailBison credentials (`email_bison_api_key`, `email_bison_instance_url`) are stored **in the DB** (`workspaces` table), not in env vars.

---

## Project Structure

```
app/
  page.tsx                          # Entry — renders <ReplyDashboard />
  layout.tsx                        # Root layout
  globals.css                       # Global styles
  api/
    analyze/route.ts                # POST — Claude Haiku reply analysis (cached in DB)
    calls/route.ts                  # GET/POST/PATCH — call booking + status updates
    calendly/
      slots/route.ts                # GET — fetch available Calendly slots
      book/route.ts                 # POST — create Calendly scheduling link
    dashboard/route.ts              # GET — aggregated dashboard data (replies, FU, calls, email stats)
    meetings/route.ts               # GET — meetings list
    replies/route.ts                # GET/PATCH — fetch/update replies
    send-reply/route.ts             # POST — proxy reply to EmailBison API
    templates/route.ts              # GET — fetch reply templates from EmailBison
    webhook/
      [workspace]/route.ts          # POST — EmailBison webhook receiver (per workspace slug)
      calendly/route.ts             # POST — Calendly webhook receiver

components/
  ReplyDashboard.tsx                # Main state orchestrator + tab layout (LARGEST FILE ~34KB)
  ReplyDetail.tsx                   # Right panel — message view + AI analysis + reply composer
  ReplyList.tsx                     # Left panel — inbox list + filters
  MasterInbox.tsx                   # Legacy inbox component (may be superseded by ReplyDashboard)
  CalendlySlotPicker.tsx            # Slot picker with timezone support + demo mode fallback
  CallBookingModal.tsx              # Modal for manual call booking
  NotificationFeed.tsx              # Notification/activity feed
  AIBadge.tsx                       # Intent/urgency badge for AI analysis results
  StatusBadge.tsx                   # new / interested / not_interested badge
  WorkspaceAvatar.tsx               # Colored avatar for workspace
  EmptyState.tsx                    # Empty state for right panel

lib/
  db.ts                             # pg Pool singleton (DATABASE_URL, ssl:false, max:10)
  ai-analysis.ts                    # Client-side helper — calls /api/analyze, returns AIAnalysis
  calendly.ts                       # Calendly API wrapper (getCalendlyUser, getEventTypes, getAvailableSlots)
  dashboard-data.ts                 # TypeScript types + mock data for dashboard (DashboardReply, FollowUpLead, MeetingLead)
  mock-data.ts                      # Mock workspaces, replies, templates (used in dev/demo mode)
  utils.ts                          # timeAgo, getInitials, applyTemplate, buildEmailBisonUrl
```

---

## Database Tables

Inferred from SQL queries across the codebase:

| Table | Key Columns |
|---|---|
| `workspaces` | `id`, `slug`, `email_bison_api_key`, `email_bison_instance_url` |
| `replies` | `id` (= EmailBison reply UUID), `workspace_id`, `workspace_slug`, `email_bison_id`, `email_bison_reply_id`, `email_bison_lead_id`, `lead_email`, `lead_name`, `lead_company`, `lead_title`, `sender_email`, `sender_email_id`, `to_email`, `to_name`, `campaign`, `subject`, `message`, `received_at`, `status`, `interested`, `meeting_booked`, `ai_analysis` (JSONB), `ai_analyzed_at` |
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

`lib/mock-data.ts` and `lib/dashboard-data.ts` contain realistic mock data for dev/demo mode. The app has a mix of components that pull from the DB (via API routes) and components that may still reference mock data. When connecting new features, always wire through the API routes — do not import mock data directly into components intended for production.

---

## Architecture Notes

- **No auth layer** — this is an internal tool for Agency Evolution. No login/session management.
- **No Prisma** — migrations must be run manually as raw SQL against the PostgreSQL instance.
- **`ReplyDashboard.tsx`** is the main orchestrator (~34KB). It manages workspace selection, tab state, and data fetching. Edit carefully.
- **`MasterInbox.tsx`** appears to be the earlier version of the inbox. `ReplyDashboard` is the current one.
- Vercel (Hobby) → Hetzner PostgreSQL: ensure `DATABASE_URL` is set correctly in Vercel project settings and that the Hetzner firewall allows Vercel's outbound IPs (or is open on 5432).
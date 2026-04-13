# Agency Evolution — External Integrations

## EmailBison

Our primary cold email sending platform. All 15 client workspaces run on a single shared instance.

**Base URL:** `https://send.emailagencyevolution.com`

### Webhook Events We Handle

| Event | What It Does |
|---|---|
| `LEAD_REPLIED` | Creates/updates a reply record in DB |
| `CONTACT_INTERESTED` | Marks lead as interested |
| `CONTACT_UNSUBSCRIBED` | Marks lead as unsubscribe, stops FU |
| `EMAIL_SENT` | Logs to `emails_sent` table |
| `MANUAL_EMAIL_SENT` | Logs manually sent emails |
| `EMAIL_OPENED` | Logs to `email_opens` table |
| `EMAIL_BOUNCED` | Logs to `email_bounces` table |
| `CONTACT_FIRST_EMAILED` | First contact event |

**Webhook endpoint:** `POST /api/webhook/[workspace-slug]`
- Dynamic route — workspace slug identifies which client the event is for
- Idempotent: `ON CONFLICT (id) DO NOTHING` prevents duplicate records

### Sending Replies

- Endpoint: `POST /api/send-reply`
- Proxies to EmailBison: `POST {instanceUrl}/api/replies/{emailBisonReplyId}/reply`
- Credentials (per workspace): `email_bison_api_key` + `email_bison_instance_url` from DB
- Merge tags resolved server-side before sending: `{FIRST_NAME}`, `{LAST_NAME}`, `{COMPANY}`, `{TITLE}`, `{{first_name}}`

### Templates

- `GET /api/templates` — fetches reply templates from EmailBison
- Templates surfaced in the reply composer for quick selection

---

## Calendly

Used to let leads self-book discovery calls directly from the reply email.

**Auth:** Single `CALENDLY_TOKEN` env var (not per-workspace — one account for all clients)

### How It Works

1. Operator includes Calendly link in reply (per client profile in SKILL.md)
2. Lead clicks → books a slot
3. Calendly fires webhook → `POST /api/webhook/calendly`
4. Booking recorded in `calls` table, `meeting_booked` flagged on reply and follow_up

### Slot Fetcher

- `GET /api/calendly/slots` — fetches next 5 days, max 9 available slots
- `CalendlySlotPicker` component in dashboard — has demo mode fallback if API unavailable
- `lib/calendly.ts` — API wrapper: `getCalendlyUser`, `getEventTypes`, `getAvailableSlots`

### Manual Booking

- Operators can also log calls manually via `CallBookingModal.tsx`
- Stored with `source: 'manual'` in `calls` table

---

## Anthropic API (Claude)

- Used for reply analysis in `/api/analyze`
- Direct fetch calls (not via SDK) with `ANTHROPIC_API_KEY`
- Model: `claude-haiku-4-5-20251001` for production analysis
- Results cached in `replies.ai_analysis` (JSONB) to minimize API costs

---

## PostgreSQL (Hetzner)

- Raw `pg` pool, no ORM
- `ssl: false` — direct Hetzner connection (not Supabase/RDS)
- Pool config: max 10 connections
- Connection string: `DATABASE_URL` env var
- Migrations: manual raw SQL (no migration runner)
- Vercel → Hetzner: ensure Hetzner firewall allows Vercel outbound IPs on port 5432

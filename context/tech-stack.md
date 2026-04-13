# Agency Evolution — Tech Stack & Infrastructure

## Application

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | NOT Next.js 13/14 — check `node_modules/next/dist/docs/` before making API assumptions |
| UI | React 19 + TypeScript 5 + Tailwind CSS 4 | |
| Icons | Lucide React | |
| Database | PostgreSQL (raw `pg` pool, no Prisma/ORM) | Parameterized queries only — `$1, $2, ...` |
| AI | Anthropic API — Claude Haiku (`claude-haiku-4-5-20251001`) | Used in `/api/analyze` for reply analysis |
| Deployment | Vercel (Hobby plan) | |
| Database Host | Hetzner | `ssl: false` — direct connection, not Supabase |

## Environment Variables

```
DATABASE_URL               # PostgreSQL connection string (ssl: false, Hetzner)
ANTHROPIC_API_KEY          # Claude Haiku for reply analysis
CALENDLY_TOKEN             # OAuth token for slot fetching (single token, not per-workspace)
EMAILBISON_BASE_URL        # https://send.emailagencyevolution.com
```

Workspace-level EmailBison credentials are in the DB (`workspaces` table), not env vars.

## Key Files

| Path | Purpose |
|---|---|
| `app/page.tsx` | Entry — renders `<ReplyDashboard />` |
| `components/ReplyDashboard.tsx` | Main orchestrator (~34KB) — workspace selection, tab state, data fetching |
| `components/ReplyDetail.tsx` | Right panel — message view + AI analysis + reply composer |
| `components/ReplyList.tsx` | Left panel — inbox list + filters |
| `lib/db.ts` | PostgreSQL pool singleton |
| `lib/ai-analysis.ts` | Client-side helper → calls `/api/analyze` |
| `lib/calendly.ts` | Calendly API wrapper |
| `app/api/analyze/route.ts` | Claude Haiku analysis, cached in DB |
| `app/api/send-reply/route.ts` | Proxy replies to EmailBison |
| `app/api/webhook/[workspace]/route.ts` | EmailBison webhook receiver |
| `app/api/dashboard/route.ts` | Aggregated dashboard data |

## Database Tables

| Table | Purpose |
|---|---|
| `workspaces` | Client workspaces with EmailBison credentials |
| `replies` | Inbound lead replies (synced from webhooks) |
| `follow_ups` | Follow-up sequence tracking per lead |
| `calls` | Booked calls (manual + Calendly) |
| `emails_sent` | Outbound email log |
| `email_opens` | Open tracking events |
| `email_bounces` | Bounce tracking events |
| `sent_emails` | Replies sent from the dashboard |

## Coding Conventions

- Next.js 16 dynamic params are **async**: `const { workspace } = await context.params` — never destructure synchronously
- DB: `pool.query(sql, [values])` — no string interpolation, ever
- Error handling: `try/catch`, return `{ error: err.message }` with appropriate HTTP status
- Webhook inserts: `ON CONFLICT (id) DO NOTHING` pattern for idempotency
- AI analysis results cached in `replies.ai_analysis` (JSONB) — never re-analyzed

## Known Bug

The opening `<a` tag on the "View in EmailBison" link in `ReplyDetail.tsx` gets dropped on regeneration. Always verify this link is intact after editing that file.

# Deployment Reference

Live deployment details for the AI Reply Desk.

---

## App URL

Production: https://inbox.agencyevolution.eu (Coolify-hosted on Hetzner)

---

## Key API endpoints

- `GET /api/replies?status=new&interested=true` — fetch replies
- `POST /api/send-reply` — send a reply through EmailBison. Body: `{ replyId, message, emailType, toEmailOverride?, toNameOverride? }`
- `POST /api/auto-reply` — trigger the auto-reply processor for a single reply. Body: `{ replyId }`
- `POST /api/webhook/[workspace]` — EmailBison webhook receiver (per workspace slug)

---

## Slack

- `#manual-replies` channel ID: `C0B0MMMMNKZ`
- `#reply-approval` channel: see `REPLY_APPROVAL_SLACK_CHANNEL` env var
- Bot token: stored as `SLACK_BOT_TOKEN` in `.env.local` and in Coolify project env vars

---

## Environment variables

All secrets live in `.env.local` (never committed) and are mirrored into Coolify's project env. Required:

```
DATABASE_URL
ANTHROPIC_API_KEY
CALENDLY_TOKEN
EMAILBISON_BASE_URL
SLACK_BOT_TOKEN
APP_URL or NEXT_PUBLIC_APP_URL
```

Workspace-level EmailBison credentials live in the `workspaces` table, not env vars.

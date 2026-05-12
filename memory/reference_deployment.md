---
name: Deployment URLs and API endpoints
description: Live deployment URL and key API endpoints for the AI Reply Desk
type: reference
originSessionId: 6f86efab-6c09-4fe5-b234-6e1ca510210d
---
**App URL:** https://inbox.agencyevolution.eu (Coolify deployment)

**Key endpoints:**
- GET replies: `/api/replies?status=new&interested=true`
- POST send reply: `/api/send-reply` — body: `{ replyId, message, emailType, toEmailOverride?, toNameOverride? }`
- POST auto-reply: `/api/auto-reply` — body: `{ replyId }`

**Slack:**
- #manual-replies channel ID: `C0B0MMMMNKZ`
- Bot token: stored as `SLACK_BOT_TOKEN` in .env.local and Coolify env vars

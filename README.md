# Agency Evolution - Master Inbox

Centralized reply management dashboard for all EmailBison workspaces.

## What this does

- Aggregates replies from all 16 EmailBison workspaces into one inbox
- Filter by workspace, status (New / Interested / Not Interested / Replied)
- One-click reply templates with first name substitution
- Mark leads as Interested / Not Interested
- "View in EmailBison" deep link per reply
- Real-time ready (SSE endpoint to be wired in Phase 2)

## Stack

- **Next.js 15** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Lucide React** (icons)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project structure

```
app/
  page.tsx              # Entry point
  layout.tsx            # Root layout
  globals.css           # Global styles

components/
  MasterInbox.tsx       # Main state orchestrator
  ReplyList.tsx         # Left panel — inbox list + filters
  ReplyDetail.tsx       # Right panel — message + reply composer
  WorkspaceAvatar.tsx   # Colored workspace avatar
  StatusBadge.tsx       # New / Interested / Not interested badge
  EmptyState.tsx        # Empty right panel

lib/
  mock-data.ts          # Mock workspaces, replies, templates (swap for API in Phase 2)
  utils.ts              # timeAgo, getInitials, applyTemplate, buildEmailBisonUrl
```

## Phase 2 — Connecting real data

### 1. Add workspace API keys to .env.local

```env
EMAILBISON_BASE_URL=https://send.emailagencyevolution.com

# One per workspace
WS_VENTURE_EXITS_KEY=your_api_key_here
WS_STATERA_KEY=your_api_key_here
```

### 2. Webhook receiver

Add app/api/webhook/[workspaceId]/route.ts — receives EmailBison webhook
events (lead_replied) and stores to DB.

### 3. Replace mock data

Replace MOCK_REPLIES in lib/mock-data.ts with a fetch from PostgreSQL via Prisma.

### 4. Wire send reply

In ReplyDetail.tsx, replace the simulated delay with a real API call to
POST /api/reply/[replyId] which proxies to EmailBison.

## Deploy to Vercel

```bash
git init
git add .
git commit -m "Initial commit — Master Inbox UI"
git remote add origin https://github.com/YOUR_USERNAME/master-inbox.git
git push -u origin main
```

Then import the repo at vercel.com — auto-detects Next.js and deploys.


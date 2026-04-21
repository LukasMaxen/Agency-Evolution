# Client Onboarding — Automated Workflow

When a new client is signed, run through every step below in order. Each step has an AI-executable action. Tell Claude: "Onboard new client [NAME] with slug [SLUG]" and it will walk through this entire checklist.

---

## Pre-Onboarding Checklist (Before Day 1)

- [ ] Contract signed and countersigned
- [ ] First invoice sent / payment received
- [ ] Slack channel created: `#[client-slug]`
- [ ] Client added to internal project tracker
- [ ] Kickoff call scheduled

---

## Step 1 — Create Client File

**AI action:** Copy `clients/_template.md` → `clients/[slug].md`

Fill in during or immediately after kickoff call:
- [ ] Client name + slug
- [ ] Primary contact name, role, email
- [ ] Slack channel
- [ ] Offer + what they're outreaching for
- [ ] Core value proposition
- [ ] ICP (industry, title, company size, geography, revenue range)
- [ ] What qualifies / disqualifies a lead
- [ ] Things they can never say or promise
- [ ] Preferred tone
- [ ] Calendly link (get from client)
- [ ] Monthly retainer amount

**AI prompt to use:**
> "Create a new client file for [CLIENT NAME] with slug [SLUG]. Here are the details from the kickoff call: [paste notes]. Fill in everything you can and flag what's missing."

---

## Step 2 — EmailBison Workspace Setup

**Owner:** Sunny

- [ ] Create new workspace in EmailBison at `https://send.emailagencyevolution.com`
- [ ] Name it exactly: `[Client Name]` (matches slug convention)
- [ ] Note the `email_bison_api_key` for this workspace
- [ ] Confirm `email_bison_instance_url` = `https://send.emailagencyevolution.com`

---

## Step 3 — Database Setup

**Owner:** Sunny / Lukas

Run this SQL against the PostgreSQL instance:

```sql
INSERT INTO workspaces (id, slug, name, email_bison_api_key, email_bison_instance_url)
VALUES (
  gen_random_uuid(),
  '[slug]',
  '[Client Name]',
  '[api_key_from_step_2]',
  'https://send.emailagencyevolution.com'
);
```

- [ ] Row inserted in `workspaces` table
- [ ] Confirm slug matches exactly what's in EmailBison

---

## Step 4 — Webhook Registration

**Owner:** Sunny

In EmailBison, register the webhook for this workspace:

- **URL:** `https://[your-vercel-domain]/api/webhook/[slug]`
- **Events to enable:**
  - `LEAD_REPLIED`
  - `CONTACT_INTERESTED`
  - `CONTACT_UNSUBSCRIBED`
  - `EMAIL_SENT`
  - `MANUAL_EMAIL_SENT`
  - `EMAIL_OPENED`
  - `EMAIL_BOUNCED`
  - `CONTACT_FIRST_EMAILED`

- [ ] Webhook registered in EmailBison
- [ ] Test webhook fires correctly (send a test event, confirm it lands in DB)

---

## Step 5 — Domain & Email Account Setup

**Owner:** Sunny

- [ ] Domains purchased / configured for this client
- [ ] Email accounts created (follow standard sending account setup SOP)
- [ ] Accounts warmed up (follow warmup SOP — [paste warmup timeline here])
- [ ] Accounts added to EmailBison workspace
- [ ] SPF, DKIM, DMARC verified on all domains

**[ADD YOUR DOMAIN + WARMUP SOP HERE]**

---

## Step 6 — Lead Sourcing

**Owner:** Sunny + Kasper

Using the ICP from `clients/[slug].md`:

- [ ] Define search criteria in Apollo / LinkedIn Sales Nav
- [ ] Pull initial list (target: [X] leads for first campaign)
- [ ] Quality check — remove obvious misfits
- [ ] Hand off to enrichment

**AI prompt to use:**
> "Build a lead sourcing strategy for [CLIENT NAME]. Their ICP is: [paste ICP from client file]. Suggest Apollo filters, LinkedIn search strings, and any other data sources to use."

---

## Step 7 — Lead Enrichment

**Owner:** Sunny

- [ ] Run list through enrichment tool ([add tool name here])
- [ ] Verify email addresses
- [ ] Enrich with: [list required fields for this client — company revenue, job title, news, etc.]
- [ ] Score and filter — remove below-threshold leads
- [ ] Upload final list to EmailBison workspace

**AI prompt to use:**
> "Build a lead enrichment workflow for [CLIENT NAME]. Their ICP is: [paste ICP]. What enrichment fields matter most and how should we personalise for this audience?"

---

## Step 8 — Campaign Strategy

**Owner:** Kasper

Using client context from `clients/[slug].md`:

- [ ] Define 2–3 initial messaging angles
- [ ] Write email sequences for each angle (subject line + 3–5 step sequence)
- [ ] Get client approval on copy (if required)
- [ ] Set up sequences in EmailBison

**AI prompt to use:**
> "Build a campaign strategy for [CLIENT NAME]. Read their client file at clients/[slug].md. Propose 2–3 angles, write subject lines for each, and draft a 3-step sequence for the strongest angle."

---

## Step 9 — Reply Management Setup

**Owner:** Lukas

- [ ] Add client Calendly link to `clients/[slug].md`
- [ ] Write FU1–FU10 templates in `clients/[slug].md`
- [ ] Add reply tone + interested/not-interested signals to client file
- [ ] Confirm client appears in AI Reply Desk (should auto-appear once DB row + webhook are live)
- [ ] Test: send a test reply via EmailBison, confirm it lands in Reply Desk with AI analysis

**AI prompt to use:**
> "Write 10 follow-up email templates for [CLIENT NAME]. Read their client file at clients/[slug].md for tone, offer, and ICP. Follow the FU sequence structure in departments/reply-management/reply-process.md."

---

## Step 10 — Kickoff & Go Live

- [ ] All sequences loaded and scheduled in EmailBison
- [ ] First send date confirmed with client (if applicable)
- [ ] Client briefed on what to expect (reply volume, timeline to first meetings)
- [ ] Internal Slack channel active with client comms being logged
- [ ] Campaign live ✓

---

## Post-Launch (Week 1–2)

- [ ] Monitor reply rates — flag anything below [X]%
- [ ] Review first batch of replies in AI Reply Desk
- [ ] Send client a week-1 update (template below)
- [ ] Identify any ICP or copy issues early and adjust

**Week-1 update email template:**

Subject: [Client Name] — Week 1 Update

Hi [Name],

Quick update on the first week of outreach:

- Emails sent: [X]
- Open rate: [X]%
- Reply rate: [X]%
- Positive replies: [X]

[Any early observations / what we're adjusting]

Next update: [date]

[Sender]

---

## Adding to This SOP

When you complete an onboarding and find a step missing or unclear, add it here. This document should get more detailed with every client we sign.

**[PASTE YOUR EXISTING ONBOARDING SOP STEPS HERE — anything not already covered above]**

# Sonaro AI — Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client — sourcing, enrichment, campaign strategy, reply management, or onboarding — read this file first.

## REPLY QUICK REFERENCE
campaign_type: ai-clinic-automation
sender: Manuele Giamminola, Co-founder, Sonaro AI
sender_email: manuelg@sonaroassist.com
offer: Free 30-day trial of Sonaro AI. Clinics vertical = managed WhatsApp service that recovers cancellations, reduces no-shows, and runs reactivation campaigns for dormant patients. Gym/PT vertical = managed WhatsApp layer for winning back lapsed members and filling empty class slots. Pick the variant that matches the lead's vertical.
calendly: https://sonaro.ai/book
always_send_calendly: false
english_call_handoff: Dominik (Manuele's partner) runs English-speaking calls. When proposing a call to an English-speaking lead, mention this so they know to expect Dominik. Manuele runs Italian-speaking calls himself.

reply_rules:
- Interested + ready to book ("send me your calendar", "let's set up a call", "happy to chat"): propose 2 specific slots in the lead's local timezone + https://sonaro.ai/book as fallback ("Alternatively, you can also grab a slot using this link"). Match Manuele's pattern: "Great to hear it. How about [DAY] at [TIME] or [DAY] at [TIME] ([LEAD TZ])?"
- "Send me more info" / "Tell me more": one brief sentence on what we do tied to their vertical (clinic vs gym), then propose a call to walk through it. Do not dump a full pitch. Reference one of: missed-call recovery, no-show reduction, lapsed-member reactivation — whichever fits their business.
- "What do you do?" / "I don't understand": same as above — short, clear, vertical-specific. Then call CTA.
- Remove-from-list + interested mixed ("please remove me, but tell me more"): ack the removal first ("done, removed"), then answer the substantive part.
- English-speaking lead booking a call: add the Dominik handoff line ("the call will be with my partner Dominik, who handles our English-speaking clients").
- Not interested / "we're fully staffed" / "we have this covered": brief acknowledge + close. No follow-up. Match Manuele's pattern: "Understood, won't follow up further. Wishing you all the best."

never:
- Never describe the offer as an "AI receptionist" — always describe it as a managed WhatsApp service that recovers cancellations, reduces no-shows, and runs reactivation campaigns for dormant patients
- Never name Tebra or any specific PMS system in cold outreach
- Never guarantee specific patient or revenue outcomes
- Never use € or £ symbols (spam trigger + compliance)
- No P.S. lines
- Never confirm specific times unless LIVE CALENDAR AVAILABILITY is in the prompt — use sonaro.ai/book

case_study_line: One clinic we work with recovered 11,000 in their first month — 5,000 of that came from reactivating dormant patients alone.

fu_context: |
  Sonaro AI sells a managed WhatsApp service that recovers cancellations, reduces no-shows, and runs reactivation campaigns for dormant patients (clinics) or managed WhatsApp layer (gyms). Free 30-day trial is the primary hook. EU-focused. Italy is the highest-performing market (8.74% reply vs 0.82-1.09% elsewhere). Sender is Manuele Giamminola, Co-founder. Booking link: https://sonaro.ai/book.

---

## Quick Reference

| Field | Value |
|---|---|
| **Status** | Active |
| **EmailBison slug** | `sonaro-ai` |
| **EmailBison instance** | `https://send.emailagencyevolution.com` |
| **Signed date** | [Date] |
| **Primary contact** | Manuele Giamminola |
| **Contact email** | [email] |
| **Slack channel** | `#[channel-name]` |
| **Calendly link** | [link] |
| **Monthly retainer** | [amount] |

---

## Offer & Positioning

**What they do:**
Sonaro AI provides a managed WhatsApp service for healthcare clinics (GP, dental, physio, aesthetics, etc.). The product recovers cancellations, reduces no-shows, and runs reactivation campaigns for dormant patients automatically.

**What they're outreaching for:**
Finding clinic owners and practice managers across the EU who are losing revenue from missed calls, no-shows, or lapsed patients.

**Core value proposition:**
A free 30-day trial of their managed WhatsApp service — no commitment, real results before they pay anything.

**Case study (include as a one-sentence proof point in copy where appropriate):**
One clinic they work with recovered 11,000 in their first month — 5,000 of that came from reactivating dormant patients alone.

**What makes them different:**
Free 30-day trial removes all risk. Addresses multiple clinic pain points in one system: missed calls, no-shows, lapsed patient reactivation, and online reviews. EU data storage. UK GDPR + PECR compliant.

**What they can never say / promise:**
Never describe the offer as an "AI receptionist" — always frame it as a managed WhatsApp service that recovers cancellations, reduces no-shows, and runs reactivation campaigns for dormant patients. Never guarantee specific revenue increases or patient acquisition numbers. No Tebra name-drops in cold outreach — too specific and assumes their tech stack.

---

## Target Audience (ICP)

| Field | Detail |
|---|---|
| **Industry** | Healthcare clinics: GP, dental, physio, aesthetics, chiropractic |
| **Company size** | Small-to-mid size clinic operators |
| **Geography** | EU-focused (not UK-specific) |
| **Job title / role** | Clinic Owner, Practice Manager, Medical Director |
| **Revenue range** | [fill in] |
| **Other criteria** | Must be running an active patient-facing clinic |

**What qualifies a lead:**
EU-based clinic owner or practice manager running an active patient-facing practice — anyone losing revenue from missed calls or no-shows.

**What disqualifies a lead:**
Hospital groups (too large/complex), non-patient-facing healthcare, outside EU.

---

## Active Campaigns

_Structure: one block per offer. Each offer lists its ICPs as rows. Changing the offer script/CTA/opener updates all ICPs under it. Changing a specific ICP updates only that send._

### Clinics — Free Trial
_What's being pitched: Sonaro AI's free trial offer for clinics — managed WhatsApp service that recovers cancellations, reduces no-shows, and runs reactivation campaigns for dormant patients._

| ICP | Status |
|---|---|
| Medical and aesthetic clinic owners (EU) | Active |

---

## Campaign Strategy

**Campaign type:** AI SaaS / clinic automation

**CTA rules:**
- Step 1: "Free 30-day trial, worth a quick 15 minutes to see how it works?"
- Step 2: "Any interest in a free 30-day trial of our managed WhatsApp service for {COMPANY}?"
- Step 3: "Worth a quick call to see how it works?"

**Key rules:**
- The free 30-day trial is the #1 hook — always include before the CTA in step 1
- NEVER describe the offer as an "AI receptionist" — always frame it as a managed WhatsApp service that recovers cancellations, reduces no-shows, and runs reactivation campaigns for dormant patients
- NEVER name Tebra in cold outreach — too specific, assumes their tech stack
- EU-focused campaign — not UK-specific
- Always include the trial in step 2 question
- Include the one-sentence case study where it fits naturally: "One clinic we work with recovered 11,000 in their first month — 5,000 of that came from reactivating dormant patients alone."

**Pain points ranked by effectiveness:**
1. Missed calls (revenue walking out the door)
2. No-shows (booked slots going empty)
3. Lapsed patient reactivation (dormant revenue)
4. Getting more online reviews

**What works:**
- Free trial CTA at step 1 is the lowest-friction possible entry
- Including {COMPANY} in step 2 makes it feel personalized and specific
- Missed calls / no-shows are universal clinic pain — lead with these
- Italy: 8.74% reply rate vs 0.82-1.09% elsewhere — 4-8x better than all other markets. Italy MUST be prioritized.
- Free trial is always the hook — "free 30-day trial" — never bury it
- EU data storage + UK GDPR/PECR compliance are strong trust signals — use when relevant
- One-sentence case study (11,000 first-month recovery, 5,000 from dormant patients) adds social proof without making guarantees

**What doesn't work:**
- Describing the product as an "AI receptionist"
- Naming Tebra or other specific PMS systems
- Generic AI claims without specifics
- UK-specific targeting
- US Lawyers: 0% interested — do not rebuild
- Euro/pound symbols in copy — remove all € and £ symbols (spam + compliance)

**Priority markets by performance:**
1. Italy — 8.74% reply (4-8x others). Law firm Owners Italy: 11.29% interested (currently paused — REACTIVATE). Local biz Italy: 12.07% interested (currently paused — REACTIVATE).
2. All other EU markets — 0.82-1.09% reply rate (secondary)
3. USA (Lawyers) — 0% — do not build

---

## Reply Guidelines

**Tone:**
Approachable and professional. Clinic owners are time-poor — keep everything short and outcome-focused.

**Interested signal:**
Any reply asking about the trial, what the service does, pricing after trial, or setup requirements.

**Not interested signal:**
"We're fully staffed", "we use a full reception team and it works", "not interested in AI."

**Common objections + how to handle:**

| Objection | Response |
|---|---|
| "We already have a receptionist" | The service handles overflow and reactivation — won't replace your team |
| "What happens after the trial?" | Answer pricing honestly if asked |
| "How does setup work?" | Redirect to a 15-minute call to walk through it |
| "We're not interested in AI" | Acknowledge, close cleanly |

**Things to never say:**
- Never describe the offer as an "AI receptionist" — always use "managed WhatsApp service that recovers cancellations, reduces no-shows, and runs reactivation campaigns for dormant patients"
- Never name Tebra or specific PMS systems in cold outreach
- Never guarantee specific patient or revenue outcomes

---

## Follow-Up Templates (FU1–FU10)

_Tone progression: FU1–3 warm/informative → FU4–6 direct/mild urgency → FU7–9 short/low pressure → FU10 close_

**FU1**
Subject:
Body:

**FU2**
Subject:
Body:

**FU3**
Subject:
Body:

**FU4**
Subject:
Body:

**FU5**
Subject:
Body:

**FU6**
Subject:
Body:

**FU7**
Subject:
Body:

**FU8**
Subject:
Body:

**FU9**
Subject:
Body:

**FU10**
Subject:
Body:

---

## Lead Sourcing Notes

**Best data sources for this client:**
Apollo, LinkedIn Sales Nav — healthcare clinic roles across EU.

**Search strings / filters that work:**
Industries: Medical Practice, Dental, Physical Therapy, Chiropractic, Aesthetics. Titles: Clinic Owner, Practice Manager, Medical Director. Geography: EU (exclude UK-specific targeting).

**Lists to avoid:**
Hospital groups, non-patient-facing healthcare, UK-only campaigns.

---

## Lead Enrichment Notes

**Key enrichment fields needed:**
Clinic type (dental, GP, physio, aesthetics). Clinic size (number of practitioners). Geography.

**Personalisation approach:**
{COMPANY} in step 2 for personalization. Reference their clinic type where known.

---

## Campaign History

| Date | Campaign name | Leads sent | Reply rate | Interested rate | Notes |
|---|---|---|---|---|---|
| Paused | Law Firm Owners Italy | — | ~11% | 11.29% | Intentionally discontinued — ICP pivot to Clinics only. Did not convert to clients. |
| Paused | Local Biz Italy | — | — | 12.07% | Intentionally discontinued — ICP pivot to Clinics only. Did not convert to clients. |
| Active | EU General (Clinics) | — | 0.82-1.09% | — | Current focus — Italy clinics within this is the priority sub-market |
| Dead | US Lawyers | — | — | 0% | Do not rebuild |

**Key insight:** Italy email metrics outperform all other markets 4-8x, but Law Firm and Local Biz audiences did not convert to paying clients. ICP is now Clinics only. Do not reactivate Law Firm or Local Biz Italy campaigns.

---

## Key Conversations

### Slack Messages
[Date] [Person]: [message]

---

### Email Conversations
[Date] From: [sender]
Subject: [subject]
[body]

---

## Internal Notes

EU-focused — not UK-specific. Never name Tebra in cold outreach. Free 30-day trial is the primary hook — never bury it.

Never describe the offer as an "AI receptionist." Always frame it as a managed WhatsApp service that recovers cancellations, reduces no-shows, and runs reactivation campaigns for dormant patients.

Always include the one-sentence case study where it fits: one clinic they work with recovered 11,000 in their first month — 5,000 of that came from reactivating dormant patients alone. Do not use currency symbols (€ or £) in copy.

Italy is the highest-performing market by a significant margin (8.74% reply vs 0.82-1.09% elsewhere). Reactivate Italy campaigns immediately. Do not waste sends on US Lawyers (0% interested).

Remove all € and £ symbols from copy — spam trigger and compliance risk.

EU data storage + UK GDPR/PECR compliance should be highlighted when prospects ask about data handling.
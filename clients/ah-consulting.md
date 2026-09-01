# AEO Consulting — Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client — sourcing, enrichment, campaign strategy, reply management, or onboarding — read this file first.

> **Note:** Renamed from "AH Consulting" to "AEO Consulting" 2026-08-27 per Kasper. The DB row, EmailBison slug (`ah-consulting`), and workspace ID (`w16`) were **not** renamed — this is a display-name change only. Campaign sender copy still signs as "Business Development, AH Consulting" — flag to Lukas if that should be updated to match.

## REPLY QUICK REFERENCE
campaign_type: agency / service (AI answer engine optimization, not M&A)
sender: Lukas Maxen, Business Development, AH Consulting (this is the outreach sender identity, NOT Austin Heaton)
founder: Austin Heaton, Founder, AEO Consulting. Handles all strategy/demo calls directly. Confirmed by Kasper 2026-09-01. When a reply proposes or confirms a call, introduce the handoff explicitly by name, e.g. "I'll get you set up with Austin Heaton, our founder, he handles all of the strategy conversations directly" — never imply the outreach sender personally runs the call.
offer: AI answer engine optimization (AEO) — making sure a brand is the one AI models (ChatGPT, Claude, Gemini) recommend to buyers at the point of purchase, with measurable results.
booking_link: https://calendly.com/austin-austinheaton/30min
icp: AI companies, marketing agencies, and other AI service providers (peer/adjacent companies in the AI and marketing-agency space).

reply_rules:
- Lead asks HOW something works (ROI tracking, measurement, mechanism): give the real high-level mechanism using ONLY what's confirmed here (how often, and in what context, AI models cite their brand, tracked over time as we optimize). Say the live example is easiest to walk through on the call, and hand off to Austin per the founder note above.
- Any reply that proposes or confirms a call should name Austin Heaton and his founder role, not just say "grab a time here" with no context on who they'll be meeting.

never:
- Never invent capabilities, product features (e.g. "a dashboard"), case studies, or results not confirmed in this file — this is the general no-fabrication rule and applies especially here since so little is documented yet.
- Never claim or imply the lead's own brand already appears in AI answers for a specific query. We don't know that, that is what the service investigates and improves, not an existing fact to assert.

---

## Quick Reference

| Field | Value |
|---|---|
| **Status** | Active |
| **EmailBison slug** | `ah-consulting` |
| **EmailBison instance** | `https://send.shieldsoutbound.com` |
| **Signed date** | TBD |
| **Monthly retainer** | TBD |
| **Active campaigns** | Austin Heaton \| AI Companies (AE) |

---

## Contacts

| Name | Role | Email | Calendly | Timezone | Notes |
|---|---|---|---|---|---|
| Lukas Maxen | Business Development (sender) | | | | Sends outreach as "Business Development, AH Consulting" |
| Austin Heaton | Founder | | https://calendly.com/austin-austinheaton/30min | | Handles all strategy/demo calls directly. Confirmed 2026-09-01: replies proposing a call should hand off to him by name, not imply Lukas/BD runs it. |

_Add client-side stakeholder contacts as they're introduced._

---

## Client Overview

**What they do:**
AEO Consulting (Austin Heaton) helps brands become the one AI models (ChatGPT, Claude, Gemini) recommend when buyers are ready to purchase — AI answer engine optimization (AEO), with measurable results.

**What makes them different:**
Focus on measurable outcomes tied to actual AI-driven recommendations, not generic visibility or SEO metrics.

**What they can never say / promise:**
No confirmed hard constraints yet.

**Slack channel:** `#aeo-consulting` (channel ID `C0BT77S0SJG` — reply-approval, see Internal Notes)

---

## Offer & Messaging

_This client's offer is an AI-visibility marketing service, not M&A — the standard GTM psychological-driver framework doesn't apply. Keeping it simple._

**The offer:**
AI answer engine optimization — making sure a brand is the one AI models recommend to buyers at the point of purchase, with results the client can measure.

**What the prospect is asked to do first:**
Take a quick call to explore fit.

**ICP (current campaign):**
AI companies, marketing agencies, and other AI service providers — i.e. peer/adjacent companies in the AI and marketing-agency space.

**Reply Guidelines**

**Tone:** Same as all other clients — conversational, warm, low-pressure.

**Interested / not-interested signals:** No special rules — obvious intent, use judgment same as other clients.

**Common objections:** Not yet documented — add as real ones come in.

**Things to never say in replies:** Nothing specific yet — default to general no-fabrication rule, never invent capabilities, case studies, or results not confirmed here.

---

## Campaigns

### Campaign: Austin Heaton | AI Companies (AE)

**Status:** Active
**Calendly link:** TBD

#### Offer
Same as above — AI answer engine optimization for AI-adjacent companies.

#### Target Audience (ICP)
AI companies, marketing agencies, other AI service providers.

#### Script Rules
**Step 1 CTA:** "Would that be worth a quick call?"
**Variables used:** `{FIRST_NAME}`
**P.S. line:** None currently.

#### Lead Sourcing / Enrichment
Not documented yet.

#### Follow-Up Sequence
Default cadence unless told otherwise: FU1 (+2 days) → FU2 (+5 days) → FU3 (+7 days) → FU4 (+7 days) → FU5 (+14 days).

#### Campaign Performance

| Date | Leads sent | Open rate | Reply rate | Interested rate | Notes |
|---|---|---|---|---|---|
| | | | | | |

---

## Archived Campaigns

| Campaign name | Status | Period active | Leads sent | Reply rate | Interested rate | Why paused/ended |
|---|---|---|---|---|---|---|
| | | | | | | |

---

## Key Conversations

### Biweekly Meeting Notes

[Date] — [Key decisions / updates from this call]

### Slack Messages

[Date] [Person]: [message]

### Email Conversations

[Date] From: [sender]
Subject: [subject]
[body]

---

## Internal Notes

- **Channel routing (corrected 2026-08-31 by Kasper):** `C0BT77S0SJG` is the raw reply feed ONLY — every single reply, unfiltered, mirrors Make's old "Reply received" format. It is NOT the approval channel.
- Actionable replies (interested / needs_info / neutral) get an AI-drafted approval card in the **global** `#reply-approval` channel, same as every standard (non-fully-automated) client. Ambiguous/time-sensitive ones go to the **global** `#manual-replies` channel. `workspaces.slack_approval_channel` is NULL for this workspace so it falls back to those global channels — do not set it back to the client's own channel.
- **If in doubt on intent or how to respond, route to `#manual-replies` rather than guessing or auto-drafting.**
- Replaced the old Make (Integromat) raw-reply-notification scenario — see [[project_make_replacement_withpebble_aeo]].

# [CLIENT NAME] — Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client — sourcing, enrichment, campaign strategy, reply management, or onboarding — read this file first.

---

## Quick Reference

| Field | Value |
|---|---|
| **Status** | Active / Paused / Churned |
| **EmailBison slug** | `[slug]` |
| **EmailBison instance** | `https://send.emailagencyevolution.com` |
| **Signed date** | [Date] |
| **Monthly retainer** | [amount] |
| **Active campaigns** | [list campaign names, e.g. "Trade Owners / Existing Franchisees"] |

---

## Contacts

| Name | Role | Email | Calendly | Timezone | Notes |
|---|---|---|---|---|---|
| [Name] | [Role at client company] | [email] | [link] | [timezone] | [e.g. primary contact, cc on all emails] |
| [Name] | [Role] | [email] | [link] | [timezone] | |

_Add a row for every stakeholder. Note which Calendly link belongs to which campaign if they differ._

---

## Client Overview

**What they do:**
[One paragraph describing the client's business — what they sell, who they serve, how long they've been operating, any notable credibility points.]

**What makes them different:**
[Differentiators that apply across all campaigns — proof points, credentials, unique model. Things we can always reference regardless of which campaign we're running.]

**What they can never say / promise:**
[Hard constraints that apply across all campaigns — e.g. no guaranteed returns, no confirmed territory availability, no naming specific PE firms.]

**Slack channel:** `#[channel-name]`

---

## Active Campaigns

_Structure: one block per offer. Each offer lists its ICPs as rows. Changing the offer script/CTA/opener updates all ICPs under it. Changing a specific ICP updates only that send._

### [Offer Name]
_What's being pitched: [one sentence — e.g. "911 Restoration franchise opportunity alongside an existing trade business"]_

| ICP | Status |
|---|---|
| [Target audience A — e.g. Trade business owners, USA] | Active |
| [Target audience B — e.g. Existing franchise owners] | Active |

### [Second Offer Name]
_What's being pitched: [one sentence]_

| ICP | Status |
|---|---|
| [Target audience] | Active |

---

## Campaigns

_Each campaign gets its own block below. Duplicate the block for each active campaign. If a campaign is paused or completed, move it to the Archived Campaigns section at the bottom._

---

### Campaign: [Campaign Name]

**Status:** Active / Paused / Completed
**Calendly link for this campaign:** [link — if different from another campaign]

_Note on sends: This campaign may have multiple active EmailBison sends (e.g. "23rd April [Campaign Name]", "[Campaign Name] California"). These are batches of the same offer and script — not separate campaigns. When updating the script, it applies to all active sends for this campaign._

#### Offer

**What this campaign is selling / recruiting for:**
[What is the prospect being asked to consider? Be specific — e.g. "Opening a 911 Restoration franchise alongside their existing trade business" not just "franchise recruitment."]

**Core value proposition:**
[The single strongest reason a prospect in this ICP should care. Lead with this.]

**Key proof points / stats to always include:**
- [Stat or fact 1]
- [Stat or fact 2]
- [Stat or fact 3]

**What they can never say in this campaign:**
[Any constraints specific to this campaign — may overlap with client-level rules or add to them.]

---

#### Target Audience (ICP)

| Field | Detail |
|---|---|
| **Industry** | |
| **Company size** | |
| **Geography** | |
| **Job title / role** | |
| **Revenue / EBITDA range** | |
| **Other criteria** | |

**What qualifies a lead:**
[What makes someone a clear fit for this specific campaign?]

**What disqualifies a lead:**
[Wrong stage, wrong geography, wrong business type, etc.]

---

#### Script Rules

**Step 1 CTA:**
[Exact wording or formula — e.g. "Worth a quick phone call?" / "Mind if I send over the teaser?"]

**Step 2 CTA:**
[Exact wording — typically a direct question referencing the offer]

**Step 3 CTA:**
[Exact wording — re-engagement, never signal sequence end]

**Variables used:**
[List merge tags — e.g. {FIRST_NAME}, {COMPANY}, {CITY}, {STATE}]

**Hooks ranked by effectiveness:**
1. [Strongest hook]
2.
3.

**What works:**
- [Angle, line, or framing that gets replies]
- [Include exact phrasing if known]

**What doesn't work:**
- [Angle or framing that flopped — never repeat]

**Formatting / spam rules specific to this campaign:**
[e.g. remove $ signs, avoid ~ symbol, never use the word "guaranteed"]

**P.S. line:**
[Include the P.S. line if used, or note "No P.S. for this campaign"]

---

#### Reply Guidelines

**Tone:**
[e.g. Conversational and warm / Formal and direct / Professional but approachable]

**Interested signal:**
[What does a genuinely interested reply look like? What words or phrases indicate real intent?]

**Not interested signal:**
[What phrases or contexts mean this lead is done?]

**Common objections + how to handle:**

| Objection | Response |
|---|---|
| [Objection 1] | [How to handle] |
| [Objection 2] | [How to handle] |
| [Objection 3] | [How to handle] |

**Things to never say in replies:**
- [Specific phrase or promise to avoid]

---

#### Lead Sourcing

**Best data sources:**
[Apollo, LinkedIn Sales Nav, specific directories, etc.]

**Filters / search strings that work:**
[Industries, titles, geography parameters, Boolean strings]

**Lists to avoid:**
[Company types, industries, geographies that waste sends]

---

#### Lead Enrichment

**Key enrichment fields needed:**
[What data points matter for personalisation in this campaign]

**Personalisation approach:**
[How we personalise — city, company revenue, recent news, job title detail, etc.]

---

#### Follow-Up Sequence

_FUs are AI-drafted per lead — not fixed templates. Claude reads the lead's original reply, their title and company, and the context fields below to generate a natural, objection-aware follow-up at each step. Every FU that includes a booking CTA uses exactly 2 available time slots + the Calendly link._

**Sequence:** FU1 (+2 days) → FU2 (+5 days) → FU3 (+7 days) → FU4 (+7 days) → FU5 (+14 days)

---

**Offer Frames**
_3–5 different ways to position the same offer. Claude uses these to keep FU2 and FU4 feeling fresh — different angle, same offer. Each frame should be 1–2 sentences, self-contained._

1. [Primary frame — the strongest angle, used in initial outreach]
2. [Alternative frame — different hook or emphasis]
3. [Alternative frame]
4. [Alternative frame]
5. [Alternative frame — optional]

---

**Case Studies**
_Real outcomes to use in FU3. Each case study should include who it was (role/company type, not necessarily named), what the result was, and any specific metric. Claude picks the most relevant one based on the lead's industry/title._

| Client type | Result | Key metric | Use when |
|---|---|---|---|
| [e.g. Trade business owner] | [e.g. Opened first franchise location within 6 months] | [e.g. £X revenue in year 1] | [e.g. Lead runs a similar trade business] |
| | | | |
| | | | |

---

**Objection Reframes**
_The most common objections for this campaign and how to reframe them in a FU context. Claude uses these in FU1 when the lead has stated a specific objection. Different from a hard no — these are leads who engaged but pushed back._

| Objection | Reframe for FU |
|---|---|
| [e.g. Not the right time] | [e.g. Acknowledge timing, ask when would be better, leave door open] |
| [e.g. Already working with someone] | [e.g. Acknowledge, pivot to what makes this different] |
| [e.g. Send me more info] | [e.g. Send one specific case study, follow up in 5 days] |

---

**Break-Up Style**
_How FU5 should feel for this campaign. Some clients want a soft exit, others want a direct "should I stop reaching out?" Energy and tone guidance._

[e.g. Soft and warm — leave the door open without any pressure. No mention of it being the final email.]

---

**FU Constraints**
_Anything Claude must never do or say in follow-ups for this campaign specifically._

- [e.g. Never mention competitors by name]
- [e.g. Never reference the number of follow-ups sent]

---

#### Campaign Performance

| Date | Leads sent | Open rate | Reply rate | Interested rate | Notes |
|---|---|---|---|---|---|
| | | | | | |

---

### Campaign: [Second Campaign Name]

_Duplicate this entire block for each additional active campaign._

**Status:** Active / Paused / Completed
**Calendly link for this campaign:**

_Note on sends: Multiple EmailBison sends may be active under this campaign. Same offer and script — different date prefix or geographic bracket._

#### Offer
#### Target Audience (ICP)
#### Script Rules
#### Reply Guidelines
#### Lead Sourcing
#### Lead Enrichment
#### Follow-Up Sequence
#### Campaign Performance

---

## Archived Campaigns

_Move completed or paused campaigns here. Keep the performance data — it's useful context for future work._

| Campaign name | Status | Period active | Leads sent | Reply rate | Interested rate | Why paused/ended |
|---|---|---|---|---|---|---|
| | | | | | | |

---

## Key Conversations

### Biweekly Meeting Notes
_Summary of each biweekly call — decisions made, feedback given, changes requested._

[Date] — [Key decisions / updates from this call]

---

### Slack Messages
_Paste important Slack threads — decisions, feedback, complaints, strategy changes._

[Date] [Person]: [message]

---

### Email Conversations
_Paste key email threads — onboarding emails, strategy discussions, client feedback._

[Date] From: [sender]
Subject: [subject]
[body]

---

## Internal Notes

[Anything that doesn't fit above — quirks, sensitivities, relationship context, things to never bring up, or context that helps when working on this account.]

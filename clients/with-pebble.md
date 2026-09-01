# WithPebble — Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client — sourcing, enrichment, campaign strategy, reply management, or onboarding — read this file first.

## REPLY QUICK REFERENCE
campaign_type: agency / service (creator/UGC content network, not M&A)
sender: Lukas Maxen, Business Development, WithPebble
offer: Daily creator/UGC content posted across a creator network, driving real organic reach and purchase intent for DTC/ecommerce brands, without added ad spend. We build a custom content concept for the prospect's brand first, before any commitment.
booking_link: https://withpebble.fillout.com/strategy-call
icp: Beauty/health/wellness brands selling physical goods (not medspa/services) to US customers, $1M+ revenue, 5-100 employees. Secondary ICP: consumer apps with $50K+ MRR.
proof_point: 40M organic views in 30 days for a recent beauty brand. NEVER name the brand, anonymous reference only, see [[feedback_never_name_sell_side_company]] / [[feedback_larsen_case_study_ban]].

reply_rules:
- Lead asks "why me" / "what would the concept be" / "how does this work for my brand": answer with the actual mechanism (match creators to their audience, build a content angle around a real product detail from their site), using ONE concrete, verifiable detail about their specific product, not a generic category label like "science-backed" or "consumable repeat-purchase model". If LEAD COMPANY CONTEXT only gives generic category-level signals and no specific named feature, keep the answer to the general mechanism and skip the personalization rather than inventing one.
- Lead agrees / says interested: offer the free custom concept, then the booking link.

never:
- Never guarantee a specific view count, engagement level, or sales result for a new prospect's brand.
- Never name the beauty brand behind the 40M-views case study.
- Never invent a reason a creator audience would want the lead's product (e.g. "an audience that is actively looking for X") unless it is directly and plainly supported by a specific fact about their product, not a category assumption.

---

## Quick Reference

| Field | Value |
|---|---|
| **Status** | Active |
| **EmailBison slug** | `with-pebble` |
| **EmailBison instance** | `https://send.shieldsoutbound.com` |
| **Signed date** | TBD |
| **Monthly retainer** | TBD |
| **Active campaigns** | WithPebble \| US |

---

## Contacts

| Name | Role | Email | Calendly | Timezone | Notes |
|---|---|---|---|---|---|
| Lukas Maxen | Business Development (sender) | | | | Sends outreach as "Business Development, WithPebble" |

_Add client-side stakeholder contacts as they're introduced._

---

## Client Overview

**What they do:**
WithPebble runs a creator/UGC content network that posts daily branded content across creators to drive organic reach and purchase intent for DTC/ecommerce brands, without increasing ad spend.

**What makes them different:**
Builds a custom content concept for the prospect's brand before any commitment is made. Proof point: 40M organic views in 30 days for a recent beauty brand (keep anonymized, never name the brand per standing rule, see [[feedback_never_name_sell_side_company]]).

**What they can never say / promise:**
No confirmed hard constraints yet. Default: never guarantee a specific view count, engagement level, or sales result for a new prospect's brand. The 40M views example is a past result, not a promise.

**Slack channel:** `#withpebble` (channel ID `C0BSXAE4JLB` — reply-approval, see Internal Notes)

---

## Offer & Messaging

_This client's offer is a marketing service, not M&A — the standard GTM psychological-driver framework doesn't apply. Keeping it simple._

**The offer:**
Daily creator/UGC content posted across a network, driving real organic purchase intent for the brand without added ad spend.

**What the prospect is asked to do first:**
Take a quick call. WithPebble offers to build a custom content concept for their brand first, before any commitment.

**ICP (confirmed by Kasper, 2026-08-28):**
- Beauty / health / wellness brands, physical goods only (not a medspa or services business)
- $1M+ annual revenue
- 5-100 employees
- Must sell to US customers
- Retail presence is fine
- TikTok Shop presence is optional, not required

**Other areas in scope:** consumer apps with $50K+ MRR (a separate, secondary ICP outside beauty/wellness).

**Proof points to use:**
- 40M organic views in 30 days for a recent beauty brand (anonymized — never name the brand)

**Hooks ranked by effectiveness:**
1. Organic reach/purchase intent without more ad spend
2. Concrete proof point (40M views/30 days)
3. Custom concept built before any commitment — low-risk first step

**Reply Guidelines**

**Tone:** Same as all other clients — conversational, warm, low-pressure, no hard sell.

**Interested signal:** Same as other clients — obvious intent (asks for details, rates, timeline, or says yes to a call).

**Not interested signal:** Same as other clients — clear decline, unsubscribe, "stop," "not interested."

**Common objections:** Not yet documented — add as real ones come in.

**Things to never say in replies:**
- Don't guarantee a specific view count, engagement, or sales outcome for the prospect's own brand.
- Don't name the beauty brand behind the 40M-views case study.

---

## Campaigns

### Campaign: WithPebble | US

**Status:** Active
**Calendly link:** TBD

#### Offer
Same as above — creator/UGC network driving organic views and purchase intent, custom concept built first.

#### Target Audience (ICP)
Same as above — beauty/health/wellness physical-goods brands, $1M+ revenue, 5-100 employees, selling to US. Also: consumer apps with $50K+ MRR.

#### Script Rules
**Step 1 CTA:** "Worth a quick call?"
**Variables used:** `{FIRST_NAME}`, `{COMPANY}`
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

- **Channel routing (corrected 2026-08-31 by Kasper):** `C0BSXAE4JLB` (`#with-pebble` or similar) is the raw reply feed ONLY — every single reply, unfiltered, mirrors Make's old "Reply received" format. It is NOT the approval channel.
- Actionable replies (interested / needs_info / neutral) get an AI-drafted approval card in the **global** `#reply-approval` channel, same as every standard (non-fully-automated) client. Ambiguous/time-sensitive ones go to the **global** `#manual-replies` channel. `workspaces.slack_approval_channel` is NULL for this workspace so it falls back to those global channels — do not set it back to the client's own channel.
- **If in doubt on intent or how to respond, route to `#manual-replies` rather than guessing or auto-drafting.**
- Replaced the old Make (Integromat) raw-reply-notification scenario — see [[project_make_replacement_withpebble_aeo]].

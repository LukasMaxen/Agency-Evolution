# GN Motion — Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client — sourcing, enrichment, campaign strategy, reply management, or onboarding — read this file first.

## REPLY QUICK REFERENCE
campaign_type: cgi
sender: Romain Guillon, Owner, GN Motion
offer: Premium CGI/3D video production for product brands. Complimentary sample matched to their specific product — zero commitment. Reference clients: L'Oreal (Revitalift), Audemars Piguet, Bang & Olufsen, Samsung.
calendly: https://app.iclosed.io/e/GNMOTION/creative-campaign-discovery-call
portfolio: https://www.canva.com/design/DAG54ftEXgA/NqsRscCn1P2PHx0ZGHLgoA/view?utm_content=DAG54ftEXgA&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=h1754ac6064
jewelry_portfolio: https://canva.link/hs3uwg2520jllvs
website: https://gnmotion.co/
always_send_calendly: false
french_market: true (match language exactly if they reply in French)
location: Based in France, works with brands worldwide (confirmed by Kasper 2026-08-11)
manual_booking_trigger: true (fully automated 2026-08-17, same pattern as Larsen Digital, see [[feedback_larsen_247_manual_booking]]. The AI cannot book calls. Any message where the lead wants to get on a call, general or a specific day/time they name themselves, routes to action:manual with NO drafted reply, NO booking link, NO acknowledgment. Only non-scheduling replies (portfolio requests, pricing questions, general interest in the sample) are eligible to auto-send, and those may close with the iClosed link above. Note: no iClosed webhook exists in this app, see [[project_gn_motion_iclosed_gap]] — if a lead later confirms they booked, set flag_meeting_booked true and send a short confirmation, not a new booking link.)
fully_automated: true (no #reply-approval step for interested/needs_info, replies send directly once quality-checked)

reply_rules:
- Lead asks for our WEBSITE, web page, "your site", "your link", or where to see us online: send the website (https://gnmotion.co/).
- Lead asks to see our work / examples / portfolio: send the portfolio link above. For a jewelry lead specifically, send jewelry_portfolio instead. Never send jewelry_portfolio to a non-jewelry lead. Pair it with an invite to a call for the complimentary sample.
- Only ever send the exact website / calendly / portfolio URLs listed above, character for character. NEVER send the retired portfolio link ending in "h6402713df7" (it is dead). If a lead asks for both the site and to see examples, the website (gnmotion.co) covers everything.
- Lead asks about pricing: redirect to call. "Best to cover after a quick call so I can understand your specific product."
- Lead interested in sample: send the sample request template (see below)
- Lead gives phone number asking to be called: post to #manual-replies (Romain must call)
- Lead writes in French: respond entirely in French. Close with "Bien cordialement."
- Lead redirected us to a colleague (via email): email that colleague directly using referral as opener

auto_suppressed:
- Peter Gerasimov: any reply mentioning this name in any field (lead name, email, company, subject, body) is auto-suppressed by the processor pre-filter and never reaches #reply-approval or #manual-replies. Enforced in code (workspaceSuppressionReason), not a drafting rule.

never:
- Never say "free" — always "complimentary"
- Never say "efficacy" for cosmetics
- Never overpromise on turnaround without checking
- No P.S. opt-out lines
- Never offer the complimentary sample unprompted when redirecting a pricing question to a call. The sample offer is only for leads who specifically ask about seeing work or a sample. Pricing redirect = call only.

fu_context: |
  Romain Guillon produces premium CGI/3D video for product brands. The offer is a complimentary (never "free") sample matched to the lead's specific product — zero commitment required to see what's possible.
  Reference clients by vertical: cosmetics (L'Oréal Revitalift launch), luxury watches (Audemars Piguet), audio/tech (Bang & Olufsen, Samsung). Use the most relevant reference for the lead's industry. Do not mix verticals in a single FU.
  FU angles: FU2 = reference a specific client in their sector and what was produced for them. FU4 = lower the bar further — "I can put together a concept specifically for [product type] before the call so you can see the output without committing to anything." For French leads, respond entirely in French and close with "Bien cordialement." Portfolio: https://www.canva.com/design/DAG54ftEXgA/NqsRscCn1P2PHx0ZGHLgoA/view?utm_content=DAG54ftEXgA&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=h1754ac6064
  Core insight: the sample offer removes all friction. FU emails should reinforce that the sample is tailored to their product, costs nothing, and requires no commitment.

sample_request_template: |
  Hi {FIRST_NAME},

  That is great to hear. To make sure the sample really hits the mark, let us chat for a few minutes about your creative goals and which product would be best to showcase.

  Feel free to grab a time here: https://app.iclosed.io/e/GNMOTION/creative-campaign-discovery-call

  {SENDER_EMAIL_SIGNATURE}

---

## Quick Reference

| Field | Value |
|---|---|
| **Status** | Active |
| **EmailBison slug** | `gn-motion` |
| **EmailBison instance** | `https://send.emailagencyevolution.com` |
| **Signed date** | [Date] |
| **Primary contact** | Romain Guillon, Founder/Owner |
| **Contact email** | [email] |
| **Slack channel** | `#[channel-name]` |
| **Calendly link** | https://app.iclosed.io/e/GNMOTION/creative-campaign-discovery-call |
| **Monthly retainer** | [amount] |

---

## Offer & Positioning

**What they do:**
GN Motion produces high-end CGI videos for consumer and product brands. They work across cosmetics, fashion, jewelry, tech, and luxury categories. Romain operates in both French and English markets.

**What they're outreaching for:**
Finding brand marketing teams or founders who need premium CGI/3D video content for product launches and brand campaigns.

**Core value proposition:**
A complimentary (never "free") CGI sample matched to the prospect's specific product — zero commitment, high signal. Then use the prep call to convert to a paid client.

**What makes them different:**
Reference clients include Audemars Piguet, Starbucks, L'Oréal (Revitalift launch). The sample offer de-risks the conversation — prospects see quality before committing.

**What they can never say / promise:**
Never call the sample "free" — always "complimentary." Never overpromise on turnaround times without checking. Never say "efficacy" for cosmetics — too clinical. No P.S. lines on consumer brand decision-makers (same rule as Acceler8rs/Larsen Digital).

---

## Target Audience (ICP)

| Field | Detail |
|---|---|
| **Industry** | Cosmetics, fashion, jewelry, tech, luxury consumer brands |
| **Company size** | [fill in] |
| **Geography** | English and French markets |
| **Job title / role** | Marketing Director, Brand Manager, Founder, Head of Content |
| **Revenue range** | [fill in] |
| **Other criteria** | Must have a physical product that benefits from CGI/3D video |

**What qualifies a lead:**
Brand marketing decision-maker or founder with a physical product in cosmetics, fashion, jewelry, or tech — someone who would benefit from premium CGI video.

**What disqualifies a lead:**
Service businesses, B2B SaaS, no physical product, brands that use only UGC/lifestyle content.

---

## Active Campaigns

_Structure: one block per offer. Each offer lists its ICPs as rows. Changing the offer script/CTA/opener updates all ICPs under it. Changing a specific ICP updates only that send._

### GN Motion Core Offer
_What's being pitched: GN Motion's growth and performance marketing service for Shopify brands._

| ICP | Status |
|---|---|
| Tech/software Shopify brand owners | Active |
| Jewelry Shopify brand owners | Active |
| Cosmetics Shopify brand owners | Active |
| Fashion Shopify brand owners | Active |
| French-market Shopify brand owners | Active |

---

## Campaign Strategy

**Campaign type:** CGI/visual production outreach

**5 Active Verticals:**
1. Core France — French-language outreach, French market
2. Tech — product specs, feature visualization
3. Jewelry — luxury, light play, premium feel
4. Fashion — lifestyle, movement
5. Cosmetics — ingredient visualization (L'Oréal Revitalift reference)

**CTA rules:**
- Step 1: "Worth a quick call to align on which product and concept would work best?"
- Step 2: "Any interest in a CGI sample based on one of your products?"
- Step 3: "Mind if I send over my portfolio?"

**Key rules:**
- Core offer is a **complimentary** (never "free") sample matched to their specific product
- The call CTA always needs a reason: "to align on which product and concept would work best"
- For French scripts: use "offert" not "gratuit," "réalisons/produisons" not "créons," no pipe in signature, close with "Bien cordialement"
- "Efficacy" is too clinical — avoid for cosmetics/general audiences
- "Skin" is too specific — avoid when targeting all cosmetics categories
- No P.S. lines on consumer brand decision-makers

**Hook structure:**
Product quality problem → proof (client name) → complimentary sample offer → call CTA

**Reference clients by niche:**
- Cosmetics: L'Oréal (Revitalift launch), Audemars Piguet, Starbucks
- Fashion: L'Oréal, Bang & Olufsen, Formula 1
- Jewelry: Audemars Piguet, L'Oréal, Bang & Olufsen
- Tech: Samsung, Garmin, Bang & Olufsen

**Vertical-specific hooks:**
- Tech: Lead with product specs / feature visualization
- Jewelry: Lead with luxury feel and light play
- Fashion: Lead with lifestyle and movement
- Cosmetics: Lead with ingredient visualization, reference L'Oréal Revitalift launch

**Portfolio link:**
https://www.canva.com/design/DAG54ftEXgA/NqsRscCn1P2PHx0ZGHLgoA/view?utm_content=DAG54ftEXgA&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=h1754ac6064

**P.S. lines:**
Do NOT include P.S. opt-out lines — consumer audience, same rule as Acceler8rs/Larsen Digital.

**What works:**
- Named reference clients (Samsung, L'Oréal, Audemars Piguet) in the right niche
- The complimentary sample offer as the primary CTA
- Portfolio link as a step 3 fallback
- Matching reference clients to the prospect's niche

**What doesn't work:**
- "Free" instead of "complimentary" (spam + devalues the offer)
- "Efficacy" for cosmetics
- Generic "skin" reference across all cosmetic categories
- Vague call CTA without a reason

---

## Reply Guidelines

**Tone:**
Professional but creative-friendly. These are marketing and brand people — slightly warmer and more visual than finance audiences.

**Interested signal:**
Any reply asking about the sample, the portfolio, turnaround time, or pricing.

**Sample request reply template:**
When a lead asks to see a sample, use this:

> Hi {FIRST_NAME},
>
> That's great to hear. I'm excited to show you how we can elevate {COMPANY}'s products.
>
> To make sure the sample really hits the mark, let's chat for a few minutes about your creative goals. I want to make sure the direction we take feels like a perfect extension of your brand.
>
> You can grab a spot on my calendar here: https://app.iclosed.io/e/GNMOTION/creative-campaign-discovery-call
>
> Looking forward to it!
>
> {SENDER_EMAIL_SIGNATURE}

**Not interested signal:**
Happy with current content agency, no CGI need, wrong product category.

**Common objections + how to handle:**

| Objection | Response |
|---|---|
| "Send me the portfolio" | Send portfolio link + follow up in 7 days |
| "We already have a CGI studio" | Acknowledge, offer sample as a comparison point |
| "What does it cost?" | Answer honestly if asked — offer the sample first |
| "Not the right time" | Acknowledge, offer to follow up in X months |

**Things to never say:**
- Never say "free" — always "complimentary"
- Never say "efficacy" for cosmetics
- Never overpromise on turnaround without checking

---

## French Market Notes

- Match language of correspondence exactly — French reply = French email
- Use "offert" not "gratuit" for the sample offer
- Use "réalisons" or "produisons" — not "créons"
- No pipe symbol (|) in French email signatures
- Closing: "Bien cordialement" or "À très vite"

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
Apollo, LinkedIn Sales Nav — marketing and brand roles at consumer product companies.

**Search strings / filters that work:**
Industries: Cosmetics, Fashion, Luxury Goods, Consumer Electronics, Jewelry. Titles: Marketing Director, Brand Manager, Head of Content, CMO, Founder.

**Lists to avoid:**
B2B, service businesses, brands without physical products.

---

## Lead Enrichment Notes

**Key enrichment fields needed:**
Product category (to match correct reference clients). Language/market (English vs French). Brand size and presence.

**Personalisation approach:**
Match reference clients to their product niche. Reference their product category in the sample offer.

---

## Campaign History

| Date | Campaign name | Leads sent | Reply rate | Notes |
|---|---|---|---|---|
| | | | | |

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

Romain operates in French and English markets — use separate campaigns and match language exactly. French campaigns need different script structure (see French Market Notes above).

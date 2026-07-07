# Acceler8rs — Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client — sourcing, enrichment, campaign strategy, reply management, or onboarding — read this file first.

## REPLY QUICK REFERENCE
campaign_type: agency_services
sender: Lukas Maxen, Co-founder, Acceler8rs
offer: 3-phase DTC brand growth system — grow profitably, scale with operating partnership, exit at 8 figures.
calendly: https://calendly.com/d/dtm8-3nx-vr9/intro-call-operating-partner (DEFAULT — operating partner / growth intro call)
calendly_ma: https://calendly.com/d/dvqt-b8q-ytq/m-a-conversation-larsen-digital (SELL-SIDE / EXIT ONLY — actual M&A or capital markets conversations)

campaign_routing: |
  FIRST, check the campaign name. It decides which track this reply belongs to. The campaign overrides the lead-words routing below.
  - Campaign name contains "Pathfinder": this is the SELL-SIDE / M&A campaign. The cold email opened by expressing acquisition interest in the lead's brand (e.g. subject "Acquisition interest in [Brand]"). Treat EVERY interested reply on this campaign as an M&A conversation from the first reply. Continue the acquisition conversation, do NOT pitch the 3-phase growth system, do NOT use more_info_template, do NOT send the operating-partner link. Use the M&A link (calendly_ma). Lukas takes these calls himself, so no hand-off line.
  - Any other campaign (the Growth & Exit Shopify campaigns): use the calendly_routing logic below (growth is the default).

calendly_routing: |
  Two booking links. Only applies to non-Pathfinder (growth) campaigns. For Pathfinder, see campaign_routing above (always M&A).
  - Growth / operating partner interest (the default for almost every reply): send the operating partner link above.
  - Sell-side / M&A / exit conversation (lead explicitly wants to discuss actually selling or exiting their business now, i.e. Phase 3): send the M&A link.
  - The sender for Acceler8rs is Lukas Maxen, who personally takes the M&A and capital markets calls, so no hand-off line is needed. Do NOT restate that this is the "M&A" or "capital markets" track. The outreach already established that (e.g. subject "Majority buyout opportunity"), so labelling the link that way is redundant and reads as templated. Just open naturally in response to the lead and share the M&A link warmly (e.g. "let's find a time" then the link).
always_send_calendly: false

reply_rules:
- CAMPAIGN CHECK FIRST: if the campaign name contains "Pathfinder", this is sell-side / M&A (see campaign_routing). Never use more_info_template, never pitch the 3-phase growth system, never send the operating-partner link. Reply as an acquisition conversation and use calendly_ma.
- Always say "your brand" never the company name variable
- Lead asks about cost/fee: redirect to a call — "Happy to walk through the structure on a quick call, it depends on where your brand is and what the goal is." Do NOT say "performance-based only, no upfront fee" — this is factually incorrect. Actual pricing is $3,500/month retainer + 10% of profitable ad spend, with a 90-day profitable-on-Meta guarantee.
- Lead interested in a call: send Calendly
- Lead asks for "more info" / "send me details" / CTA was to send more info: use the approved more_info_template below. Do not send a booking link only — the CTA was to send information.
- Lead asks for case studies: send https://docs.google.com/document/d/1CYV_nA_4-y_HYqtvCW-DfW9thmgZ2VjqHICJK1ZsQo0/edit?usp=sharing
- Lead gives specific day/time: post to #manual-replies
- Lead wants a sell-side / M&A / exit conversation (explicitly wants to discuss actually selling or exiting the business now, Phase 3, not growth): send the M&A link (calendly_ma above), not the operating partner link. Lukas takes those calls himself, so no hand-off line. Do NOT label the link as the "M&A" or "capital markets" track, the outreach already made that clear. Just open naturally and share the link warmly.
- Pathfinder lead asks for more detail before booking a call: always include the M&A calendar link directly in the reply so they can book without a follow-up exchange. Never make them ask again. See the approved Pathfinder more-detail templates below for tone and structure.

never:
- Never guarantee specific revenue outcomes
- Never use {COMPANY} — always "your brand"
- Never mention pricing before they ask
- Never say "performance-based only, no upfront fee, no retainer" — this is factually incorrect for Acceler8rs. The model has a retainer. Do not say this even if the lead asks; redirect to a call instead.
- Never open a reply by leading with the commercial model
- No P.S. opt-out lines

signature_rule: |
  Always close replies with the {SENDER_EMAIL_SIGNATURE} variable only. Never write out the sender name and title by hand.
  Do NOT add a written sign-off (no "Best," or "Mvh," followed by Lukas Maxen / Head of Corporate Development) in addition to the variable. EmailBison resolves {SENDER_EMAIL_SIGNATURE} to the full signature at send time, so a hand-written sign-off would double the signature.

more_info_template: |
  (GROWTH CAMPAIGNS ONLY. Do NOT use this on the Pathfinder sell-side campaign — see campaign_routing.)

  Hi {FIRST_NAME},

  Sounds great!

  To give you some more details, we run a 3-phase system for consumer brands:

  1: Grow (Acceler8rs.com) — Our goal is to find PMF and build a profitable acquisition engine, to start generating strong cash flow.
  2: Scale (LarsenDigitalMarketing.com) — Operating partner for brands above 7 figures/year (P&L + forecasting, growth execution, KPI refinement + weekly growth management, often with equity).
  3: Exit — M&A planning and transaction execution through our investment banking partners.

  Here's an example of what 4 months in our Grow phase looked like for a brand we took from $6.3k/mo to $93.2k/mo in DTC sales: https://docs.google.com/document/d/1CYV_nA_4-y_HYqtvCW-DfW9thmgZ2VjqHICJK1ZsQo0/edit?usp=sharing

  If this seems like a fit, I'd love to learn more about your plans with the brand. Here is my calendar if you'd like to explore further: https://calendly.com/d/dtm8-3nx-vr9/intro-call-operating-partner

  {SENDER_EMAIL_SIGNATURE}

pathfinder_more_detail_templates: |
  Use these as reference for tone and structure when a Pathfinder lead asks for more detail before booking. Always include the M&A calendar link directly. Pick the most appropriate variant based on context (language, how much warmth/detail the lead seems to want). Never mix in growth campaign framing.

  --- VARIANT A (English, concise) ---
  Hi {FIRST_NAME},

  Happy to share a bit more before we get on a call.

  The buyer is a private investment group actively acquiring established consumer brands. They have committed capital, are open to majority buyouts where the founder keeps some equity, and are focused on brands with room to grow. They move quickly when there is a genuine fit.

  Beyond that the specifics are better covered on a confidential call, simply because there is a limit to what we can share in writing at this stage.

  If that sounds like enough to go on, feel free to grab a time here: https://calendly.com/d/dvqt-b8q-ytq/m-a-conversation-larsen-digital

  {SENDER_EMAIL_SIGNATURE}

  --- VARIANT B (English, fuller / more detailed) ---
  Hi {FIRST_NAME},

  Happy to share a bit more before we get on a call.

  The buyer is a private investment group that has been quietly acquiring consumer brands across Europe and North America for several years. They have a strong track record of working closely with founders post-acquisition rather than just coming in and flipping the business. They are not a fund with a short exit horizon, they take a longer view and like to keep the brand's identity intact. Committed capital, majority buyout structure, and happy to leave meaningful equity with the founder.

  Beyond that the specifics are better covered on a confidential call, partly because of what we have agreed with them in terms of confidentiality at this stage.

  I genuinely think it is worth 20 minutes of your time. Feel free to grab a slot here: https://calendly.com/d/dvqt-b8q-ytq/m-a-conversation-larsen-digital

  {SENDER_EMAIL_SIGNATURE}

  --- VARIANT C (Danish-language) ---
  Hej {FIRST_NAME},

  Tak for hurtig svar.

  Vi rækker ud til en liste af udvalgte brands med samme email, og det er sjældent vi rammer en dansker, men lad os da bare tage den på dansk herfra!

  Lidt om køber: de har opkøbt consumer brands i Europa og Nordamerika i flere år, arbejder tæt med stifter/founder frem for at komme ind og vende hele virksomheden på hovedet. De har kapital klar til 2-3 køb i 2026 og forventningen er at du ville få muligheden for at blive i virksomheden og beholde en andel efter opkøbet.

  Det giver dig en chance for at mindske din risiko ved at realisere en del af værdien nu, mens du samtidig tager del i den fremtidige vækst.

  Hvis det lyder relevant tager jeg gerne en intro snak for at fortælle lidt mere om muligheden og potentiel salgsværdi.
  20 minutter er som regel nok. Her er min kalender hvis det lyder interessant: https://calendly.com/d/dvqt-b8q-ytq/m-a-conversation-larsen-digital

  {SENDER_EMAIL_SIGNATURE}

fu_context: |
  Acceler8rs is a 3-phase DTC brand growth system: grow profitably, scale with an operating partner, then exit at 8 figures.
  Case studies (use exact numbers — specificity builds trust): Headwaters Studio (£60k/year to £1M+ in 24 months). UK campaigns use £, US use $.
  Strongest differentiator line: "Most agencies help you grow OR help you sell. We do both." Use this in FU2 if the brand seems at a growth stage with no exit plan yet.
  FU angles: FU2 = case study most relevant to their brand type. FU4 = the exit angle — "brands that focus only on growth often leave significant value on the table when they eventually sell." Always say "your brand," never the company variable. Case study link: https://docs.google.com/document/d/1CYV_nA_4-y_HYqtvCW-DfW9thmgZ2VjqHICJK1ZsQo0/edit?usp=sharing

---

## Quick Reference

| Field | Value |
|---|---|
| **Status** | Active |
| **EmailBison slug** | `acceler8rs` |
| **EmailBison instance** | `https://send.emailagencyevolution.com` |
| **Signed date** | [Date] |
| **Primary contact** | Lukas Maxen, Co-founder |
| **Contact email** | [email] |
| **Slack channel** | `#[channel-name]` |
| **Calendly link (default)** | https://calendly.com/d/dtm8-3nx-vr9/intro-call-operating-partner |
| **Calendly link (M&A / sell-side)** | https://calendly.com/d/dvqt-b8q-ytq/m-a-conversation-larsen-digital |
| **Monthly retainer** | [amount] |

---

## Offer & Positioning

**What they do:**
Acceler8rs (Accelerators) is a consumer brand growth and exit planning company co-founded by Lukas Maxen. They work with eCommerce and DTC brands across three phases: growth, scaling, and exit.

**What they're outreaching for:**
Finding DTC/eCommerce brand owners who want to grow their brand profitably, scale it with an operating partner, and eventually execute a high-value exit.

**Core value proposition:**
"Most agencies help you grow OR help you sell. We do both and everything in between." Full 3-phase coverage from finding PMF and building an acquisition engine through to a managed M&A exit.

**The 3-Phase System:**
1. **Grow** (Acceler8rs.com) — Find PMF, build profitable acquisition engine, generate cash flow
2. **Scale** (LarsenDigitalMarketing.com) — Operating partner for 7-figure+ brands (P&L, forecasting, growth execution, KPI, often equity)
3. **Exit** — M&A planning and transaction execution via investment banking partners

**What makes them different:**
End-to-end: growth + scaling + exit in one relationship. The case study results are exceptional and verifiable.

**Pricing (only mention if asked):**
$3,500/month retainer + 10% of profitable ad spend.

**Guarantee:**
Profitable on Meta ads within 90 days, or full refund. This is the core risk reversal for Phase 1 (Accelerator). Always included in campaign scripting — in the process/approach sentence of Step 1 and the phase breakdown of Step 3.

**What they can never say / promise:**
Never guarantee specific revenue outcomes. Never volunteer pricing unprompted.

---

## Pricing / Model

**Actual pricing:** $3,500/month retainer + 10% of profitable ad spend. This is the correct fee structure when pricing is raised by a lead.

**Important — do not misrepresent the model:**
Never state the model is "performance-based only, no upfront fee, no retainer." This is factually incorrect. Do not reference pricing or fee structure unless the lead asks, and when they do, use only the approved language above. Do not characterise the engagement as having no upfront fee or no retainer.

---

## Target Audience (ICP)

| Field | Detail |
|---|---|
| **Industry** | eCommerce, DTC consumer brands |
| **Company size** | Early-stage to 7-figure brands |
| **Geography** | [fill in] |
| **Job title / role** | Founder, Owner, CEO |
| **Revenue range** | [fill in] |
| **Other criteria** | Brand must have a product and some traction — not pre-revenue |

**What qualifies a lead:**
eCommerce/DTC brand founder looking to grow, scale, or prepare for an exit.

**What disqualifies a lead:**
B2B SaaS, no product, service businesses without a brand.

---

## Active Campaigns

_Structure: one block per offer. Each offer lists its ICPs as rows. Changing the offer script/CTA/opener updates all ICPs under it. Changing a specific ICP updates only that send._

### Shopify Brands — Growth & Exit
_What's being pitched: Scale a Shopify brand to 7-figures, then position and execute a clean exit — full operating partnership from growth through M&A._

| ICP | Status |
|---|---|
| UK Shopify brand owners | Active |
| USA Shopify brand owners | Paused |

---

## Campaign Strategy

**Campaign type:** eCommerce brand growth and exit

**CTA rules:**
- Step 1: "Want me to send over the case study?" or "Worth a quick call to walk through what that could look like for your brand?"
- Step 2: "Any interest in working with a team that handles growth, scaling, and the exit end to end?"
- Step 3: "Want me to send over the case study?"

**Variable rules:**
- Always use "your brand" — NEVER use {COMPANY} variable
- This is non-negotiable across all Acceler8rs scripts

**Case studies to reference:**
- Headwaters Studio: £60k/year → £1M+/24 months (UK client — use £)
- General: Brand from $6,342 to $93,210/month in 4 months (3.75x ROAS) (US client — use $)

**Currency rules:**
- UK campaigns: use £ for all case study figures
- US campaigns: use $ for all case study figures

**Case study link:**
https://docs.google.com/document/d/1CYV_nA_4-y_HYqtvCW-DfW9thmgZ2VjqHICJK1ZsQo0/edit?usp=sharing

**P.S. lines:**
Do NOT include P.S. opt-out lines for Acceler8rs — consumer brand founders will use it to say no.

**What works:**
- Specific full numbers ($6,342 and $93,210, not "$6k and $93k")
- Case study CTA outperforms direct call ask for cold DTC outreach
- "Most agencies help you grow OR help you sell. We do both." is the strongest differentiator line
- Recipient-focused openers outperform results-first openers
- Shopify-specific targeting significantly outperforms broad eCommerce targeting
- UK campaigns: 30.66% interested rate vs USA 21.43% — UK audience converts better

**What doesn't work:**
- {COMPANY} variable — always "your brand"
- Rounded numbers — specificity is trustworthy
- P.S. opt-out lines
- Ecom Industries USA broad targeting — 0% interested rate, do not use

---

## Reply Guidelines

**Tone:**
Conversational and warm. DTC founders are entrepreneurs — not corporate, not formal. Keep it human.

**Interested signal:**
Any reply showing curiosity about the model, asking about results, asking what working together looks like.

**Not interested signal:**
Happy with current agency, not looking to grow, B2B pivot, shutting down.

**Things to never say:**
- Never guarantee specific revenue outcomes
- Never volunteer pricing before they ask
- Never use {COMPANY} — it's always "your brand"

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
Apollo, LinkedIn Sales Nav — DTC/eCommerce founder titles.

**Search strings / filters that work:**
Industries: eCommerce, Consumer Goods, Apparel, Health & Wellness, Beauty. Titles: Founder, Owner, CEO. Exclude: B2B SaaS, services, non-product brands.

**Lists to avoid:**
B2B businesses, service companies, pre-revenue brands.

---

## Lead Enrichment Notes

**Key enrichment fields needed:**
Brand/product type, revenue range if available, existing team size.

**Personalisation approach:**
"your brand" always — no {COMPANY}. Reference their product category where natural.

---

## Campaign History

| Date | Campaign name | Leads sent | Reply rate | Interested rate | Notes |
|---|---|---|---|---|---|
| Active | Shopify Brand Owners UK | — | — | 30.66% | Top performer — UK audience converts at high rate |
| Draft | Shopify Brand Owners UK — Guarantee | — | — | — | New angle: 90-day refund guarantee as hook. Campaign ID 463, sequence ID 454. 3x Step 1 variants, Step 2 (7-day wait), Step 3 (7-day wait). 2,000/day limit (set manually in EB — API doesn't support it). Launched 2026-05-01. |
| Active | Shopify Brand Owners USA | — | — | 21.43% | Solid — Shopify-specific targeting required |
| Dead | Ecom Industries USA | — | — | 0% | Failed — do not rebuild. Too broad. |

**Key insight:** Shopify-specific targeting dramatically outperforms broad eCommerce audience. Always build lists with Shopify filter applied.

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

LinkedIn for Lukas skews toward Agency Evolution (B2B/PE), not Acceler8rs. Keep messaging and positioning separate between the two. Never mix Agency Evolution framing into Acceler8rs outreach.

**Approved reply example (Pathfinder / M&A campaign — name correction):**
The following was reviewed and approved. Use as a reference for tone and structure on Pathfinder replies where the lead's name was wrong in the original email:

> Hi Peter,
> Apologies for getting your name wrong in the first email.
> Happy to share more. The buyer has committed capital and is actively looking for established consumer brands with room to grow. A confidential call is the easiest way to give you the full picture and see if there is a fit.
> Feel free to grab a time here: https://calendly.com/d/dvqt-b8q-ytq/m-a-conversation-larsen-digital
>
> {SENDER_EMAIL_SIGNATURE}

**Approved reply examples (Pathfinder / M&A campaign — lead asks for more detail before booking):**
The following three variants were reviewed and approved. Use the pathfinder_more_detail_templates section above for the full text of each. Key principles extracted from these approvals:
- Always include the M&A calendar link directly in the reply — never make a lead who asked for more detail send a second message just to get the link.
- Share enough about the buyer to make the call feel worth their time (committed capital, founder-friendly structure, majority buyout with retained equity) without crossing confidentiality lines.
- Acknowledge when the conversation can move to the lead's language (e.g. Danish) — match their language if they write in it.
- Signature: always close with the {SENDER_EMAIL_SIGNATURE} variable only, for both English and Danish replies. Never hand-write "Best," or "Mvh," followed by the name and title, that doubles the signature since EmailBison resolves the variable at send time.
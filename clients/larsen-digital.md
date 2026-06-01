# Larsen Digital — Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client — sourcing, enrichment, campaign strategy, reply management, or onboarding — read this file first.

## REPLY QUICK REFERENCE
campaign_type: agency_services
sender: Nicklas Larsen, Founder, Larsen Digital
offer: DTC brand growth and exit planning. M&A partners closed $1B+ in CPG transactions. Goal: 8-figure exit. 250M+ in Shopify revenue managed.
calendly: https://calendly.com/larsen-digital-marketing/intro
always_send_calendly: true (LARSEN DIGITAL EXCEPTION: always send Calendly even when lead gives specific day/time. Find natural reason: "easiest to lock something in here", "calendar fills up fast")

reply_rules:
- Lead shows general interest (no specific timeframe): send Calendly. Use the live slots from LIVE CALENDAR AVAILABILITY block if present.
- Lead asks for meeting in a specific human-stated timeframe ("next week", "this week", "Monday morning", "Tuesday afternoon"): route to manual. A human picks the actual slot and confirms.
- Lead asks about fees: do not volunteer pricing or fee structure. Reply: "Happy to walk you through the details on a quick call." Do NOT say "fully performance-based, no upfront fee or retainer" — this is factually inaccurate and must never appear in any reply.
- Lead asks for case studies: mention Motel Margarita (£25k to £102k/month in 90 days), KyiKyi (£13k to £140k/month in 60 days)
- Lead already booked: confirm in 2 lines max. Flag meeting_booked = true. Stop FU sequence.
- Lead asks what we do: explain the M&A angle, growth built toward a clean 8-figure exit, not just ads
- Lead asks for more info ("tell me more", "share more details", "send the info"): use more_info_body_template below, but the FIRST LINE must acknowledge what they actually said, do not hard-code "Happy to share more".
- Lead forwards to a colleague ("@Gilbert have a chat", "looping in [Name]"): use referral_handover_template below. Short reply, CC the original sender, lead with Calendly.
- Lead agrees with a point in the cold email ("yes you're probably right", "fair point"): use info_body but open with "Glad that resonated" or "Appreciate that", not "Happy to share more".

reply_body_rules: |
  HARD LIMIT, every reply body must be 90 words or less. 2-3 short paragraphs maximum, no dump.

  TWO DISTINCT REPLY PATTERNS based on what the lead actually asked. Pick the right one.

  PATTERN A, lead asked "why are you interested in MY company" / "what made you reach out":
  Open by naming what about THEIR brand made them stand out, using a specific EXIT SIGNAL from LEAD COMPANY CONTEXT (consumable LTV, patented IP, own manufacturing, premium margin, strong brand identity, category buyer interest). One short sentence on what we do (we help founders maximize exit value). Slot close. Example shape:
    "What made [BRAND] stand out was [EXIT SIGNAL], that's the kind of thing that makes brands attract serious buyer interest at exit. We help founders grow the parts of the business that move the needle when you eventually sell. Would [SLOT 1] or [SLOT 2] work?"

  PATTERN B, lead asked "send me more info" / "tell me more" / "share details about how you work":
  Open with brief acknowledgment + one plain sentence on what we do (we help founders maximize the value of their brand at exit). Tie it to ONE specific EXIT SIGNAL we noticed about their brand. Slot close. Example shape:
    "Happy to share more. What we do is help founders maximize the value of their brand at exit, both by growing the right parts of the business and by working with our M&A partners on the deal itself. [BRAND] caught our eye because [EXIT SIGNAL with one short reason it matters for exit]. Would [SLOT 1] or [SLOT 2] work?"

  FRAMING RULES across both patterns:
  - NEVER say "we focus on [category] brands" or "we work with [category]". We do NOT focus on categories. We focus on brands that look exit-worthy.
  - The reason for reaching out is always ONE specific exit-worthy attribute of THEIR brand, drawn from LEAD COMPANY CONTEXT EXIT SIGNALS.
  - If no LEAD COMPANY CONTEXT EXIT SIGNALS are available, fall back to acknowledging the lead's message and going straight to a slot proposal without the exit framing.
  - If LIVE CALENDAR AVAILABILITY has 2 slots, propose them: "Would [SLOT 1 NATURAL] or [SLOT 2 NATURAL] work for a quick call?" + Calendly fallback. If no slots, just send Calendly link.

  Do NOT dump our full value prop (dual-track, $850k/mo case, $1B+ M&A, structuring options). Save that for the call. The reply's job is to get the call booked, not pre-sell.

  NEVER open a reply by leading with the commercial model. Never say "performance-based", "no upfront fee", or "no retainer" in any reply. These phrases are factually inaccurate for Larsen Digital and must not appear anywhere in reply copy.

  PREFERRED CTA FORMAT (confirmed by Kasper, 2026-05-29):
  "If this is relevant, let's grab 15 minutes to discuss growth and valuation/exit options for [BRAND]. Are you free [DATE 1] or [DATE 2]? If not, here is my calendar: https://calendly.com/larsen-digital-marketing/intro"
  The CTA must always include a reason for the call specific to the lead. Never end with a bare calendar link and nothing else.

referral_handover_template: |
  Hi [NEW_PERSON_FIRST_NAME],

  [ONE LINE: acknowledge the intro from the original sender by first name. e.g. "Thanks for the intro, [ORIGINAL_SENDER_FIRST_NAME] mentioned you'd be the right person to chat with."]

  [SLOT LINE: If LIVE CALENDAR AVAILABILITY has 2 slots, write "Would [SLOT 1 NATURAL] or [SLOT 2 NATURAL] work for a quick call? If not, easiest is to grab a time here: https://calendly.com/larsen-digital-marketing/intro" Otherwise just "Easiest is to grab a time here: https://calendly.com/larsen-digital-marketing/intro"]

  {SENDER_EMAIL_SIGNATURE}

  [Set recipient_email to NEW_PERSON's email, recipient_name to their display name. ALWAYS set cc_emails to [ORIGINAL_SENDER_EMAIL], non-negotiable, the introducer must stay in the loop. Do NOT dump value props, case studies, or the full info pitch. They have been pre-greenlit by the original sender, the goal is just to get the call booked.]

template_personalization_rules:
- BRAND = the actual correctly formatted brand name (from signature, website, or LinkedIn). Never use the {COMPANY} merge variable. If you cannot determine a clean brand name, write "your brand" instead.
- CATEGORY = the lead's specific product category in plural form (e.g. apparel, beauty, supplements, footwear, food & beverage, skincare, sportswear, prebiotic supplements). Infer from the lead's company name, signature, or message. Avoid generic terms like DTC or consumer goods.
- SLOT 1 NATURAL / SLOT 2 NATURAL = the natural-language strings from the LIVE CALENDAR AVAILABILITY block above, e.g. "Monday at 1pm BST" or "Tuesday at 9am EST". Use them exactly as given, do not reformat the date or time.
- Only colon allowed in the body is the one before the Calendly URL. No other colons anywhere.
- No em dashes, no en dashes, no semicolons inside the template. Use periods, commas, parentheses.

never:
- Never guarantee exit valuations
- Never use {COMPANY} — always "your brand"
- Never mention pricing/fee unless asked. If asked, reply: "Happy to walk you through the details on a quick call." Do not describe the model as "performance-based", "no upfront fee", or "no retainer" — this is factually inaccurate for Larsen Digital and must not appear anywhere in reply copy.
- Never open a reply by leading with the commercial model. Never say "performance-based", "no upfront fee", or "no retainer" in any reply — this is factually inaccurate for Larsen Digital and must not appear anywhere in reply copy.
- No P.S. opt-out lines
- Never confirm specific time slots ("next Friday works" = wrong)

fu_context: |
  Nicklas Larsen runs Larsen Digital — DTC brand growth with a built-in exit strategy. 250M+ in Shopify revenue managed. M&A partners have closed $1B+ in CPG transactions.
  Case studies (use exact numbers): Motel Margarita (£25k to £102k/month in 90 days), KyiKyi (£13k to £140k/month in 60 days), Headwaters Studio (£60k/year to £1M+ in 24 months). $0 to $850k/month in 4 months is available for US brands.
  Key differentiator: "We only take on 15 brands at a time" — use this in FU2 to create genuine scarcity without pressure language. Always say "your brand," never {COMPANY}.
  FU angle progression: FU2 = case study matched to their brand size/stage. FU4 = the exit angle — brands that grow without an exit strategy often undervalue themselves when they eventually sell. Nicklas helps build toward a clean 8-figure exit from day one. Every FU must include the Calendly link: https://calendly.com/larsen-digital-marketing/intro

---

## Quick Reference

| Field | Value |
|---|---|
| **Status** | Active |
| **EmailBison slug** | `larsen-digital` |
| **EmailBison instance** | `https://send.emailagencyevolution.com` |
| **Signed date** | [Date] |
| **Primary contact** | Nicklas Larsen, Founder |
| **Contact email** | [email] |
| **Slack channel** | `#[channel-name]` |
| **Calendly link** | https://calendly.com/larsen-digital-marketing/intro |
| **Monthly retainer** | [amount] |

---

## Offer & Positioning

**What they do:**
Larsen Digital is a DTC brand growth and exit planning firm founded by Nicklas Larsen (age 26). Similar model to Acceler8rs — they work with consumer brands to drive growth, scale profitably, and execute a high-value exit. Client cap: 15 clients maximum (this cap is Larsen Digital's — do not attribute it to Acceler8rs).

**What they're outreaching for:**
Finding DTC/eCommerce brand owners who want a clear path from where their brand is now to a profitable 7-figure exit.

**Core value proposition:**
Track record of 250M+ in Shopify revenue. Goal is an 8-figure exit. M&A partners have closed $1B+ in CPG transactions. Compensation is fully bespoke and aligned to the business's end goal (growth, profitability, or EV) so incentives stay aligned as we scale.

**What makes them different:**
Specific exit target (8-figure). Deep M&A network ($1B+ in CPG exits closed by partners). Compensation aligned to the client's outcome.

**What they can never say / promise:**
Never guarantee exit outcomes or specific valuations. Never volunteer fee structure unprompted. Never describe the engagement as "performance-based", "no upfront fee", or "no retainer" — this is factually inaccurate. If a lead asks about fees, reply: "Happy to walk you through the details on a quick call."

---

## Pricing / Model

Do not reference pricing or fee structure unless the lead explicitly asks. Never state the model is "performance-based only, no upfront fee, no retainer." This is factually incorrect. If a lead asks about fees, reply: "Happy to walk you through the details on a quick call." No other fee language should appear in any reply copy.

---

## Target Audience (ICP)

| Field | Detail |
|---|---|
| **Industry** | eCommerce, DTC consumer brands |
| **Company size** | 7-figure+ brands with growth potential |
| **Geography** | [fill in] |
| **Job title / role** | Founder, Owner, CEO |
| **Revenue range** | 7-figure brands |
| **Other criteria** | Must have a real product brand with traction |

**What qualifies a lead:**
DTC/eCommerce brand founder with a real product brand looking to scale and/or exit profitably.

**What disqualifies a lead:**
B2B SaaS, service businesses, pre-revenue, no real brand.

---

## Active Campaigns

_Structure: one block per offer. Each offer lists its ICPs as rows. Changing the offer script/CTA/opener updates all ICPs under it. Changing a specific ICP updates only that send._

### Performance Only Offer
_What's being pitched: Larsen Digital's performance-only engagement model for Shopify brand owners._

| ICP | Status |
|---|---|
| Shopify brand owners (USA) | Active — **PERFORMANCE FLAG: 0% interested rate. If 1,000+ emails sent, pause and do not rebuild as standalone angle. Always lead with M&A-focus instead.** |

### M&A-focus
_What's being pitched: Larsen Digital's M&A-focused growth and exit service for Shopify brand owners._

| ICP | Status |
|---|---|
| Shopify brand owners (USA) | Active |

---

## Campaign Strategy

**Campaign type:** eCommerce brand growth and exit

**CTA rules:**
- Step 1: "Got 15 minutes this week or next?"
- Step 2: "Any interest in a clear path from where your brand is now to a profitable 7-figure exit?"
- Step 3: "Want me to send over the case study?"

**CTA format (preferred):**
"If this is relevant, let's grab 15 minutes to discuss growth and valuation/exit options for [BRAND]. Are you free [DATE 1] or [DATE 2]? If not, grab a slot here: https://calendly.com/larsen-digital-marketing/intro"

**Variable rules:**
- Always use "your brand" — NEVER use {COMPANY} variable
- This is non-negotiable across all Larsen Digital scripts

**Key stats to reference:**
- 250M+ in Shopify revenue managed
- 8-figure exit target
- M&A partners: $1B+ in CPG transactions closed
- Results: $0 → $850k/month in 4 months; $152k → $1.1M/month in 13 months

**Case studies to reference (shared with Acceler8rs):**
- Motel Margarita: £25k → £102k/month in 90 days
- KyiKyi: £13k → £140k/month in 60 days
- Headwaters Studio: £60k/year → £1M+/year in 24 months

**Client cap framing (when relevant):**
"We only take on 15 clients at a time" — this is a Larsen Digital differentiator. Do not use for Acceler8rs.

**P.S. lines:**
Do NOT include P.S. opt-out lines for Larsen Digital — consumer brand founders will use it to say no.

**What works:**
- Specific exit target (8-figure) resonates with ambitious founders
- Case study CTA for step 3 outperforms call ask
- "your brand" always — never {COMPANY}
- M&A-focus angle outperforms performance-only angle by 5-6x on reply rate
- UK audience: fewer replies but 60-66% interested rate when they reply — high quality
- Shopify-specific targeting (M&A-focus Shopify USA: 18,983 lead pool)

**What doesn't work:**
- {COMPANY} variable
- P.S. opt-out lines
- Vague outcome promises
- Performance-only offer framing on its own: 0% interested rate — discontinue as standalone angle. Always lead with M&A-focus.

---

## Reply Guidelines

**Tone:**
Conversational and direct. DTC founders — keep it human, not corporate.

**Interested signal:**
Any reply showing curiosity about the model, the exit path, or case studies.

**Not interested signal:**
Happy with current setup, not looking to scale or exit, B2B pivot.

**Things to never say:**
- Never guarantee exit valuations
- Never mention pricing or compensation model unless the lead explicitly asks. If asked, reply: "Happy to walk you through the details on a quick call."
- Never use {COMPANY} — always "your brand"
- Never describe the engagement as "performance-based", "no upfront fee", or "no retainer" — this is factually inaccurate for Larsen Digital

**Calendly rule (Larsen Digital only):**
Always send the Calendly link — even when the lead mentions specific availability or a preferred time. Never book manually. Instead, find a natural, valid reason to send the link anyway (e.g. "easiest way to lock something in", "calendar fills up fast", "grab whichever slot works on your end"). The excuse must feel genuine, not forced. If the lead says yes/interested/happy to chat, always close with the Calendly link.

---

## Reply Templates

### More Info Response (lead asks "tell me more" / "send more info")

Use when a lead replies positively to the cold email and asks for more details, more info, a deck, or how we work. Designed for DTC founders on large digital campaigns. Always personalize NAME and BRAND before sending. Pull two live Calendly slots in the lead's timezone before send (manual lookup until per-client Calendly tokens are wired, see "Open Workflow Items" below).

Subject (when threading is broken, otherwise reply in-thread):
Re, more on how we work

Body:

Hi NAME,

Happy to share more.

We run a model built around one outcome, maximizing the value of your brand when you eventually exit. Traditional advisors package the numbers you already have. We step in earlier and actively shape the numbers you'll bring into the transaction to increase the enterprise value.

We take over multi-channel growth and retention. For context on velocity, last year we took 2 brands past 8 figure run rates. One went from $0 to $850k/mo in 4 months, a global brand you would recognize instantly. Our M&A co-advisors have closed $1B+ in consumer transactions, giving us a clear read on what strategic and PE buyers pay a premium for and how to position your brand for the best possible exit.

If this is relevant, let's grab 15 minutes to discuss growth and valuation/exit options for [BRAND]. Are you free [DAY at TIME, their TZ] or [DAY at TIME, their TZ]? If not, grab a slot on my calendar here: https://calendly.com/larsen-digital-marketing/intro

Looking forward to connecting,

Nicklas Larsen
Founder, Larsen Digital

---

**Personalization rules for this template:**
- NAME = lead first name from signature or LinkedIn
- BRAND = the actual, correctly formatted brand name (from email signature, website, or LinkedIn). Never use the {COMPANY} merge variable
- CATEGORY = the lead's actual product category, plural (e.g. "apparel", "beauty", "supplements", "footwear", "home & living", "food & beverage", "skincare", "sportswear"). Infer from the brand's website, product line, or LinkedIn industry. Avoid generic terms like "DTC" or "consumer", be specific to what they sell
- Two time slot placeholders = pulled live from Nicklas's Calendly, converted into the lead's timezone. Pick one mid-morning and one early-afternoon slot in their TZ for best conversion
- Lead's timezone = inferred from country/city in signature, LinkedIn location, or email domain. If unknown, default to UK time and note it in the line (e.g. "10am UK")
- Keep the Calendly link as the fallback even when proposing times

**Open workflow items (unblock live slot pulling):**
- Nicklas to generate a Calendly Personal Access Token from his Larsen Digital account (Integrations → API & Webhooks → Personal Access Tokens)
- Add token to `.env.local` as `CALENDLY_TOKEN_LARSEN_DIGITAL`
- Refactor `lib/calendly.ts` + `app/api/calendly/slots/route.ts` to support per-client tokens (lookup keyed by client slug, fallback to global token)
- Same pattern will apply to other clients once they each provide their own Calendly token

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
Industries: eCommerce, Consumer Goods, Apparel, Health & Wellness, Beauty, CPG. Titles: Founder, Owner, CEO.

**Lists to avoid:**
B2B businesses, service companies, pre-revenue.

---

## Lead Enrichment Notes

**Key enrichment fields needed:**
Brand/product type, revenue range, Shopify vs other platform.

**Personalisation approach:**
"your brand" always. Reference product category where natural.

---

## Campaign History

| Date | Campaign name | Leads sent | Reply rate | Interested rate | Notes |
|---|---|---|---|---|---|
| Active | M&A Focus Shopify USA | 18,983 pool | — | — | Primary active campaign — M&A angle, Shopify-specific |
| Active | M&A Focus UK | — | Lower | 60-66% | Fewer replies but very high quality |
| Dead | Performance-Only Offer | — | — | 0% | Do not rebuild as standalone angle |

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

Similar model to Acceler8rs but different positioning (8-figure exit focus). Keep Larsen Digital and Acceler8rs messaging separate — different senders, different Calendly links.
# ACT Capital — Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client — sourcing, enrichment, campaign strategy, reply management, or onboarding — read this file first.

## REPLY QUICK REFERENCE
campaign_type: mixed — check campaign name carefully
sender: Jeff Zanardi, Managing Director, ACT Capital Advisors
calendly: https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting
always_send_calendly: false
manual_booking_trigger: true (fully automated 2026-08-17, same pattern as Larsen Digital, see [[feedback_larsen_247_manual_booking]]. The AI cannot book calls. Any message where the lead wants to get on a call, general ("let's chat", "when are you free") or a specific day/time they name themselves, routes to action:manual with NO drafted reply, NO Calendly link, NO acknowledgment. Only non-scheduling replies (info requests, objections, valuation/NDA questions) are eligible to auto-send, and those may close with the Calendly link above.)
fully_automated: true (no #reply-approval step for interested/needs_info, replies send directly once quality-checked)

campaign_types_in_this_account:
- "Sell Side Advisory" / "Northern Cali" / "Contractor Acquisition (Strategic buyer outreach from owners)" = sell_side_advisory. Jeff represents a buyer. Lead is a business owner. Goal: get them on a call. NO teaser. Send Calendly only.
- "Tequila Acquisition" / "Excavation" / "Contractor Acquisition" / "Landscaping" (emailing PE firms/buyers) = mandate_buyer. Jeff represents a company for sale. Lead is a PE firm or investor. Send correct teaser + Calendly.

mandate_teasers:
- Tequila: https://www.actcapitaladvisors.com/open-deals/high-growth-premium-tequila-company/ (triggers: tequila, spirits, beverage, alcohol)
- Excavation: https://www.actcapitaladvisors.com/open-deals/highly-profitable-excavation-civil-construction-company-in-the-southern-atlantic-region/ (triggers: excavation, civil construction, earthwork, grading)
- General Contractor: https://www.actcapitaladvisors.com/open-deals/highly-profitable-general-contractor-and-construction/ (triggers: general contractor, construction, design-build)
- Landscaping: https://www.actcapitaladvisors.com/open-deals/profitable-full-service-landscape-construction-maintenance-outdoor-infrastructure-platform/ (triggers: landscape, landscaping, lawn care, grounds maintenance, outdoor infrastructure, hardscape, irrigation, turf)
- NDA is embedded within each teaser page. Always send teaser link and note NDA is accessible through it.

reply_rules:
- sell_side_advisory leads: interested = send Calendly, no teaser. "Feel free to grab a time here: [calendly]"
- mandate_buyer leads: interested = send correct teaser + Calendly. Match teaser to campaign using trigger keywords above.
- Buyer asks about financials, key deal details, or more information — and teaser has NOT yet been shared: embed the teaser link directly in the reply body. Do not direct them to a webpage to find it themselves. Send the asset to them.
- Buyer asks about valuation: redirect to teaser and call. "Best discussed on a call."
- Buyer asks who the seller is: NDA framing. "Standard practice to keep confidential before NDA."
- Lead pushes back wanting proof of relevance/fit BEFORE they'll sign an NDA (e.g. "can't NDA until I know it's actually in my space"): clarify that confidentiality protects the specific company we represent (that part stands, always), but the CALL ITSELF requires no NDA, it's exactly where fit/relevance gets confirmed before anything formal. Never assert or imply the represented company is in the lead's specific category to entice them onto the call, that fabricates a fit that hasn't been confirmed. Applies to both sell_side_advisory and mandate_buyer leads. Confirmed wording (Kasper, 2026-08-13): "Completely fair question, but to clarify, the confidentiality isn't about [X]'s identity on your side, it's the company we're representing that needs to stay confidential until an NDA is in place, that's standard practice and protects our client. The call itself doesn't require an NDA, that's exactly where we can confirm whether it's actually relevant to your space before anything formal is needed."
- Buyer asks about price: send teaser + NDA link + pull to call.
- Lead asks whether ACT is representing a buyer or looking to broker their sale: do NOT dismiss the brokerage/sell-side angle. ACT is both. If the current buyer is interested, ACT will make the introduction. If the buyer is not interested in this specific company, ACT can help the owner find a different buyer. Always leave both doors open in the reply.

never:
- Never name the buyer before a call
- Never give valuation estimate in writing
- Never name specific company being sold until NDA signed
- Never tell a business owner that ACT is not in the business of brokering their sale — ACT is a sell-side intermediary and can help them find a buyer regardless of whether the current outreach buyer is a fit
- Never direct a lead to navigate to a webpage to find the teaser themselves — if the teaser hasn't been sent yet and they're asking for details, embed the link directly in the reply

fu_context: |
  Jeff Zanardi runs ACT Capital Advisors — a Sacramento-based sell-side M&A firm representing owners ready to exit in the $5M-$50M revenue range. For sell-side advisory leads (business owners), the angle is: a qualified buyer has expressed interest in their type of business, and a 45-minute call is the next step to explore fit. For mandate campaigns (PE/investor leads), the angle is: a profitable, well-run company in their target sector is available — teaser has the details.
  Re-engagement angles: ACT has a strong track record closing deals in the $5M-$50M range. Jeff's follow-ups work best when they reference the specific sector (tequila, construction, excavation) rather than generic M&A language. The deal window is real — processes close on timelines. Reference that the process is actively moving and the opportunity to engage is time-limited without using pressure language.
  Proof: Follow-up campaigns achieve 30.77% interested rate — significantly higher than cold outreach. Tequila mandate: 60% interested among PE/FO leads.

---

## Quick Reference

| Field | Value |
|---|---|
| **Status** | Active |
| **EmailBison slug** | `act-capital` |
| **EmailBison instance** | `https://send.emailagencyevolution.com` |
| **Signed date** | [Date] |
| **Primary contact** | Jeff Zanardi, Managing Director |
| **Contact email** | [email] |
| **Slack channel** | `#[channel-name]` |
| **Calendly link** | https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting |
| **Monthly retainer** | [amount] |

---

## Offer & Positioning

**What they do:**
ACT Capital Advisors is a sell-side M&A advisory firm based in Sacramento, California. They represent business owners looking to sell and connect them with qualified buyers in the $5M–$50M revenue range.

**What they're outreaching for:**
Sell-side deal sourcing — identifying California-based business owners in their target sectors who are open to exploring a sale or exit.

**Core value proposition:**
Access to a network of qualified buyers actively pursuing acquisitions in the $5M–$50M revenue range across commercial, industrial, construction, and digital media sectors.

**What makes them different:**
California-focused, deep regional buyer relationships, strong track record in commercial and industrial M&A.

**What they can never say / promise:**
No valuation guarantees. No naming buyers before a call. No commission-only arrangements.

---

## Target Audience (ICP)

| Field | Detail |
|---|---|
| **Industry** | Commercial, industrial, construction, digital media |
| **Company size** | $5M–$50M revenue |
| **Geography** | California |
| **Job title / role** | Owner, Founder, CEO, President |
| **Revenue range** | $5M–$50M |
| **Other criteria** | Owner-operated businesses with sellable EBITDA |

**What qualifies a lead:**
California-based business owner in commercial, industrial, construction, or digital media, with revenue in the $5M–$50M range and openness to exploring a sale.

**What disqualifies a lead:**
Outside California, not an owner/decision-maker, revenue outside the target range.

---

## Active Campaigns

_Structure: one block per offer. Each offer lists its ICPs as rows. Changing the offer script/CTA/opener updates all ICPs under it. Changing a specific ICP updates only that send._

### Sell Side Advisory
_What's being pitched: ACT Capital's M&A advisory services to business owners considering an exit ($5M–$50M revenue)._

| ICP | Status |
|---|---|
| Business owners — commercial & industrial, USA (general) | Active |
| Business owners — Northern California | Active |

### Tequila Acquisition
_What's being pitched: Representing a tequila brand acquisition opportunity to potential buyers._

| ICP | Status |
|---|---|
| PE firms and family offices | Active |
| Strategic acquirers and brand owners | Active |

### Excavation Company
_What's being pitched: Representing a specific excavation company for acquisition to potential buyers._

| ICP | Status |
|---|---|
| Strategic and financial buyers in construction/excavation | Active |

### Contractor Acquisition
_What's being pitched: Representing a contractor business for acquisition to strategic buyers._

| ICP | Status |
|---|---|
| Strategic buyers in contracting and construction | Active |

---

## Campaign Strategy

**Campaign type:** Sell-side M&A

**CTA rules:**
- Step 1: "Want me to send over the teaser?"
- Step 2: "Any interest in exploring a sale or exit for {COMPANY}?"
- Step 3: "Want me to send the teaser before we close the process?"

**Key rules:**
- Include revenue figures AND EBITDA in step 1 — both matter to the seller
- Use {STATE} not {CITY} for geographic personalization — broader feels more natural
- Remove dollar signs from revenue figures to avoid spam filters
- Never mention company names being sold (confidentiality)
- Never name the buyer before a call
- Preferred meeting format: Google Meet

**What works:**
- Teaser CTA outperforms call CTA. Specific revenue + EBITDA figures in step 1.
- Follow-up campaign: 15.12% reply rate, 30.77% interested — significantly underutilized, should be expanded
- Tequila Owners: 60% interested rate — best performer in the account by a wide margin
- Northern Cali Sell Side: 28.07% interested — volume workhorse

**What doesn't work:**
Valuation promises, naming buyers upfront, generic openers without sector/geography context.

**CRITICAL — Confidentiality rule:**
Never name Northern Coil (or any specific company being sold) in outreach until NDA is signed. Use industry category only.

---

## Active Sell-Side Mandates

ACT Capital also runs **buyer outreach campaigns** — where they represent a company for sale and email PE firms, strategic acquirers, and investors. These are distinct from their normal sell-side sourcing campaigns (which email business owners). When a reply comes from a buyer/investor on one of these mandates, use the templates below — not the standard reply guidelines.

**Core logic for mandate replies:**
- Prospect expresses interest or asks for more info → send the correct teaser + calendar link. If the teaser has not yet been shared, embed the teaser link directly in the reply body — do not direct them to a webpage to find it themselves.
- Prospect asks about financials or key deal details and teaser has not yet been shared → embed the teaser link directly in the reply. Send the asset to them, don't make them navigate to it.
- Prospect asks about price/valuation → send teaser + NDA link, redirect to call for details. Use this framing: "Here are the links to the teaser and NDA: [teaser] / [NDA]. Happy to cover everything in more detail on a quick call."
- Prospect asks who the seller is → NDA framing: not able to share before NDA is in place
- Prospect says not a fit → polite exit, 2–3 lines max

**ACT Capital NDA rule:** The NDA is embedded within the teaser page itself. When replying to any interested buyer lead, always send the teaser link and note that both the teaser and NDA are accessible through it. Then push to a call for details.

---

### Mandate 1 — Premium Tequila Company
**Sender:** Jeff Zanardi, Managing Director, ACT Capital Advisors
**Calendly:** https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting
**Teaser:** https://www.actcapitaladvisors.com/open-deals/high-growth-premium-tequila-company/
**Trigger keywords:** tequila, spirits, beverage, alcohol, premium brand, consumer goods

**Reply template:**
> Hi {FIRST_NAME},
>
> I appreciate the quick response. Here is the teaser for the opportunity: https://www.actcapitaladvisors.com/open-deals/high-growth-premium-tequila-company/
>
> Happy to walk you through the details on a quick call. Feel free to grab a time here: https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting or let me know what works for you and we will coordinate.
>
> {SENDER_EMAIL_SIGNATURE}

---

### Mandate 2 — Excavation & Civil Construction Company
**Sender:** Jeff Zanardi, Managing Director, ACT Capital Advisors
**Calendly:** https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting
**Teaser:** https://www.actcapitaladvisors.com/open-deals/highly-profitable-excavation-civil-construction-company-in-the-southern-atlantic-region/
**Trigger keywords:** excavation, civil construction, earthwork, grading, site prep, southern Atlantic

**Reply template:**
> Hi {FIRST_NAME},
>
> I appreciate the quick response. Here is the teaser for the opportunity: https://www.actcapitaladvisors.com/open-deals/highly-profitable-excavation-civil-construction-company-in-the-southern-atlantic-region/
>
> Happy to walk you through the details on a quick call. Feel free to grab a time here: https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting or let me know what works for you and we will coordinate.
>
> {SENDER_EMAIL_SIGNATURE}

---

### Mandate 3 — General Contractor & Construction Company
**Sender:** Jeff Zanardi, Managing Director, ACT Capital Advisors
**Calendly:** https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting
**Teaser:** https://www.actcapitaladvisors.com/open-deals/highly-profitable-general-contractor-and-construction/
**Trigger keywords:** general contractor, construction, design-build, commercial construction, California contractor

**Reply template:**
> Hi {FIRST_NAME},
>
> I appreciate the quick response. Here is the teaser for the opportunity: https://www.actcapitaladvisors.com/open-deals/highly-profitable-general-contractor-and-construction/
>
> Happy to walk you through the details on a quick call. Feel free to grab a time here: https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting or let me know what works for you and we will coordinate.
>
> {SENDER_EMAIL_SIGNATURE}

---

## Reply Guidelines

**Tone:**
Professional and direct. These are California business owners considering a significant transaction — be credible and concise.

**Interested signal:**
Any reply asking about buyers, process, valuation, deal structure, or timeline.

**Not interested signal:**
"Not for sale", "not the right time", "happy with current situation."

**Common objections + how to handle:**

| Objection | Response |
|---|---|
| "Who is your buyer?" | NDA standard practice framing — call is the next step |
| "What's the valuation?" | Can't answer without knowing more → pull to call |
| "We're not for sale" | Acknowledge, keep door open, reframe as exploratory |
| "Send me a proposal" | Brief context + redirect to call |
| "What's your fee?" | Answer honestly if asked, never volunteer |
| "Can you send financials / more details?" | If teaser has not yet been shared, embed the teaser link directly in the reply. Do not point them to a webpage to find it — send the asset to them. |
| "Are you representing a buyer, or are you trying to broker my sale?" | Never dismiss the brokerage angle. ACT is both a buyer-side connector and a sell-side intermediary. If the buyer in the current outreach is interested, Jeff will make the introduction. If not, ACT can help the owner find the right buyer through their broader network. Always leave both doors open. |

**Things to never say:**
- Never confirm buyer identity before a call
- Never give a valuation estimate in writing
- Never agree to commission-only
- Never tell a business owner that ACT does not broker sales — ACT is a sell-side advisory firm and can represent them in a broader process if the current buyer is not the right fit
- Never direct a lead to navigate to a webpage to find the teaser themselves — if the teaser hasn't been sent yet and they're asking for details, embed the link directly in the reply

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
Apollo, LinkedIn Sales Nav — owner/founder titles in commercial, industrial, construction, digital media.

**Search strings / filters that work:**
Geography: California. Industries: Commercial Real Estate Services, Industrial Machinery, Construction, Digital Media. Revenue: $5M–$50M. Titles: Owner, Founder, CEO, President.

**Lists to avoid:**
Outside California, non-owners, companies outside the $5M–$50M range.

---

## Lead Enrichment Notes

**Key enrichment fields needed:**
Revenue, EBITDA if available, company age, sector classification.

**Personalisation approach:**
{STATE} for geographic personalization. Revenue/sector details in step 1 body.

---

## Campaign History

| Date | Campaign name | Leads sent | Reply rate | Interested rate | Notes |
|---|---|---|---|---|---|
| Active | Northern Cali Sell Side | — | — | 28.07% | Volume workhorse — California sell-side focus |
| Active | Tequila Owners | — | — | 60% | Best performer in account — niche audience, high intent |
| Active | Follow-Up Campaign | — | 15.12% | 30.77% | Underutilized — expand this campaign |

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

[Anything that doesn't fit above]
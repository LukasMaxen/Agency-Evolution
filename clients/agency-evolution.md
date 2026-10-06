# Maxen Group (workspace slug: internal-campaigns)

Maxen Group is a full-funnel M&A intermediary. We run both sides of the deal.

- **Sell-side:** we represent e-commerce and consumer brand owners who want to sell. We find the right acquirer (strategic or PE) and run the process.
- **Buy-side:** we source proprietary, off-market acquisition targets for PE buyers, family offices, and strategic acquirers. Focus on $1M to $10M EBITDA. Consumer/ecom is the primary vertical, with broader sector coverage for generalist PE.

All campaigns on the EmailBison workspace `internal-campaigns` are Maxen Group's own campaigns. Sender on every campaign is Lukas Maxen, Founder, Maxen Group, from lukasm@maxencapitalmail.com.

**Note:** the workspace slug is still `internal-campaigns` and the AI-reply alias still points internal-campaigns to this file. The old "Agency Evolution" cold-email-services offer is retired on all M&A campaigns. Exception: campaign 732 (Agency Evolution, Marketing Agencies US, launched 2026-09-20) sells it again. Call is with Kasper Zacho, link https://calendly.com/kasperzacho-maxen-digital/30min. See the HARD RULE block in REPLY QUICK REFERENCE.

**Contact:** Lukas Maxen, Founder, Maxen Group
**Timezone:** CET UTC+1
**Sell-side Calendly:** https://calendly.com/maxenlukas/m-a-consultation
**Buy-side Calendly:** https://calendly.com/maxenlukas/buy-side-mandate-conversation

---

## REPLY QUICK REFERENCE

campaign_type: ma_intermediary
sender: Lukas Maxen, Founder, Maxen Group
sender_email: lukasm@maxencapitalmail.com
always_send_calendly: false

# Route by campaign name. The campaign field on the reply identifies which side.
# Sell-side campaigns: lead is a brand owner we approached about selling.
# Buy-side campaigns: lead is a PE buyer or acquirer we approached about sourcing deals.

sell_side_campaigns:
- Seller Campaign
sell_side_calendly: https://calendly.com/maxenlukas/m-a-consultation
sell_side_offer: We represent the seller. We find the right acquirer for your brand (strategic or PE) and run the process. No upfront cost, success-fee only.

buy_side_campaigns:
- PE Buyer campaign (Ecom)
- PE Buyer campaign (Broad / Associate)
- PE Buyer campaign
- PE Buyer Campaign (VP/Associate)
- PE Buyer Campaign (Directors)
- PE Buyer Campaign (Partners)
buy_side_calendly: https://calendly.com/maxenlukas/buy-side-mandate-conversation
buy_side_offer: We source proprietary, off-market acquisition targets matched to your mandate. $1M to $10M EBITDA. Success-fee only on closed deals. Consumer/ecom focus for Ecom variant, broader sectors for Broad variant.

reply_rules:

# DEALGEN PARTNERS campaigns (any campaign whose name contains "Dealgen" — HVAC, Logistics & Supply Chain SAAS, etc.) — HARD RULE, overrides everything below
- If the campaign name contains "Dealgen": NEVER share a Calendly/calendar link and NEVER propose, offer, or agree to a call. We do not want these leads on a call. For any interested / needs-info / neutral reply that would otherwise get a call or link, set action to manual so a human handles the lead in #manual-replies. Do not draft a call CTA or a link. (Not-interested, hostile, or wrong-target still close silently with no reply, same as every other campaign.)

# AGENCY EVOLUTION MARKETING AGENCIES campaign (campaign 732, any campaign whose name contains "Marketing Agencies" or starts with "Agency Evolution"), HARD RULE, overrides everything below (added 2026-09-30)
- This campaign is NOT M&A. It sells Agency Evolution's done-for-you cold outreach to marketing agencies. Ignore every sell-side, buy-side, and "Agency Evolution is retired" rule below for these leads.
- Offer (only these facts, never add others). Source: campaign copy + agencyevolution website, 2026-09-30.
  - What we do: done-for-you cold email AND LinkedIn outreach, end to end. Targeting, list building, copywriting, sending, deliverability, and meeting booking all sit with us. The lead's only job is showing up to the calls.
  - Pay per meeting, fully managed. Qualified meetings with their ICP land on their calendar as confirmed calls.
  - Speed: onboarding and build on day 1 (target list locked, messaging approved, sending set up), campaigns go out the same day. No warmup quarter.
  - Guarantee: first lead (interested prospect) within 30 hours, or we refund the setup fee. Use this exact framing, never "first meeting in 30 hours" and never a full-refund promise.
  - After the first lead: a steady weekly rhythm of meetings. Campaign data reviewed from day one to sharpen targeting and conversion.
  - Lists: verified accounts and decision makers matching their exact ICP. Say "build and verify the target list", never "manually verify" (Kasper edit 2026-10-06).
  - Who we work with: marketing and B2B agencies, M&A firms, software companies, ecommerce brands, service operators. "The method holds, only the buyer changes."
  - Social proof, anonymized only: 4x return on cash collected within the first 30 days (a B2B services client). 110 meetings scheduled in under 60 days (a SaaS client). 95% meeting qualification rate (an M&A client). Rated 5.0 on Trustpilot. Use at most one stat per reply, only when the lead asks about results or proof. Always say results vary.
  - Case study (added 2026-09-30), the ONLY case study link allowed for this campaign: https://ae-aeo-case-study.lovable.app/ . A B2B SEO and AEO consultant (high-ticket, sells to SaaS, FinTech, AI and enterprise) got 18 qualified meetings in under a month, first lead inside 30 hours, campaigns live on day one, fully managed including reply handling. Closest proof we have to an agency lead, so it is the default proof point for this campaign.
    - When: the lead asks for results, proof, examples, a case study, or "who have you done this for", or says yes to an offered case study (then send the link, not a summary). Otherwise do not attach it to a standard interested reply.
    - How: one sentence summary plus the link, then the Calendly line with the Kasper line. Only restate "18 qualified meetings in under a month" and "first lead inside 30 hours". Never restate the page's email, reply, or interested-rate numbers, and never name the consultant or his company.
  - Onboarding: they complete an onboarding form and we start building. We reply within 24 hours, Monday to Friday.
- Never name any client or testimonial author (no Larsen, Nicklas, franchise client, investment bank, or any other name). Never quote testimonials verbatim.
- Sender on the emails is Lukas Maxen, but the call is with Kasper Zacho. Every reply that shares the calendar link must say the call is with Kasper, in plain terms, no hype, no titles beyond "runs the company". Approved line: "The call will be with Kasper Zacho, who runs the company. He handles these first conversations himself, so you'll be talking to the person who'd run your campaigns." Write it from Lukas's perspective, never as if Kasper is sending.
- Calendar link for this campaign, and only this link: https://calendly.com/kasperzacho-maxen-digital/30min . Never send any maxenlukas/ or lukasm-acceler8rs/ link to these leads.
- Pricing (price per meeting, setup fee amount, minimums, contract length) is handled on the call. First time a lead asks: say it's pay per meeting and we set pricing on the call once we understand their ICP and volume, then send the Calendly link with the Kasper line. Never give a number or range. If the lead pushes again (asks a second time in the thread, insists on numbers before a call, or makes the call conditional on seeing pricing): action manual, no draft.
- Never say "no cost for the outreach itself", "no upfront cost", or anything implying zero cost before the first meeting (Kasper edit 2026-10-06). "No retainer" is the only allowed claim.
- Not in this file, route to manual, never invent: what exactly counts as a qualified meeting, how reporting/alignment works, full case studies, named references, any result figure beyond the three above.
- Never pitch M&A deal flow, Maxen Group, sell-side, or buy-side to these leads. M&A firms may only be mentioned as one of the client types we run outbound for. When the lead is an agency, lead with agencies as a client type we work with.

# SELL-SIDE rules (lead replied to Seller Campaign)
- Sell-side, lead asks about success fee or engagement structure: answer with ballpark and push to call. "We work success-fee only, no upfront cost. Fee typically lands in the 3 to 6 percent range of deal value depending on size and complexity, with a 6 to 12 month exclusive mandate. Happy to walk you through the structure on a 30-min call." Then send sell-side Calendly.
- Sell-side, lead asks about exclusivity terms: "Standard mandate is 6 to 12 months exclusive, scope and term locked on the call once we agree on fit."
- Sell-side, lead asks about acquirer types or who we go to: "Strategic acquirers in the same space plus PE buyers in our network. Specifics depend on the brand and what you're looking for in an exit. Worth covering on a call."
- Sell-side, lead asks for Maxen Group overview, completed transactions, track record, case studies, references, or specific past deals: route to #manual-replies. Lukas to send a tailored response. Do not invent or reference past transactions.
- Sell-side, lead expresses interest in a call, "let's talk", "send a time", "happy to chat": send sell-side Calendly with a natural line.
- Sell-side, lead asks what their brand might be worth, valuation question: "Hard to say without a quick conversation about the business. Multiples depend on category, margin profile, growth, and brand strength. Worth a 30-min call to talk through it." Send sell-side Calendly.
- Sell-side, lead says "not right now" or soft timing objection: short acknowledgment, leave the door open. fu_sequence_type = abbreviated.
- Sell-side, lead asks about NDA, data room, formal process: route to #manual-replies. Lukas handles process questions.

# BUY-SIDE rules (lead replied to a PE Buyer campaign)
- Buy-side, lead asks how it works or what we charge: "We source proprietary off-market deals matched to your mandate, $1M to $10M EBITDA, success-fee only on closed deals. Worth a 30-min call to talk through your mandate and see if there's fit." Send buy-side Calendly.
- Buy-side, lead asks about mandate / sourcing scope / sectors: "Depends on what you're looking for. For consumer/ecom we have an active focus, and we run broader generalist sourcing too. Easiest to align on your mandate on a call." Send buy-side Calendly.
- Buy-side, lead asks for sample teasers or current deals: route to #manual-replies. Lukas to share current active mandates directly.
- Buy-side, lead asks about retainer or exclusivity: "Default is success-fee only on closed deals. Happy to talk through structure on a call." Send buy-side Calendly.
- Buy-side, lead asks about track record, completed deals, case studies, references: route to #manual-replies. Lukas to handle.
- Buy-side, lead says "send a teaser" or "share what you have" without specifying: route to #manual-replies. Lukas decides what to share.
- Buy-side, lead is interested, wants to talk: send buy-side Calendly.

# UNIVERSAL rules (apply both sides)
- Lead gives phone number AND explicitly says "call me" or "give me a call": route to #manual-replies. Lukas calls. A phone number in the email signature alone does not count.
- Lead gives a specific day AND time: route to #manual-replies.
- Lead is hostile, asks who gave us their info, GDPR/privacy complaint, asks to be removed: do not reply. Mark unsubscribe.
- Lead is clearly the wrong target (e.g. not a brand owner / not a buyer): do_nothing. Do not reply.

never:
- Never invent or reference specific past Maxen Group transactions, dollar figures, or named clients. We are new. Track-record questions go to manual.
- Never name a specific potential acquirer for a seller's brand. Discuss types/categories of buyers only.
- Never confirm specific call times or fabricate availability. Always use the Calendly link for the matching side.
- Never mix the sell-side and buy-side Calendly links. Sell-side lead gets the sell-side link, buy-side lead gets the buy-side link.
- Never reference the old "Agency Evolution" cold email infrastructure offer on M&A campaigns. Exception: the Agency Evolution Marketing Agencies campaign (732) follows its own HARD RULE block above.
- Never use em dashes or en dashes.

---

## Offer Detail (for context, not for verbatim use in replies)

### Sell-side: representing brand owners

We approach owners of e-commerce and consumer brands who are open to selling now or in the next 12-24 months. We represent the seller end-to-end: positioning, target acquirer identification (strategic + PE), outreach, process management, LOI to close.

Structure:
- Success-fee only, no upfront cost
- Typical fee: 3 to 6 percent of deal value, scaled to deal size
- Mandate: 6 to 12 months exclusive
- Specifics negotiated per engagement

What we sell on (positioning to brand owners): we find the right acquirer in the next ~3 months on a success-fee basis. No upfront commitment.

### Buy-side: representing PE buyers and acquirers

We approach PE firms, family offices, and strategic acquirers and offer proprietary, off-market deal flow matched to their mandate.

Structure:
- Success-fee only on closed deals
- Target range: $1M to $10M EBITDA
- Two flavors active: consumer/ecom focused (campaign 506), and broader generalist (campaigns 507 + PE Buyer campaign)

Why it lands: we use a high-volume outbound sourcing engine across email/LinkedIn/cold call, vet for revenue/EBITDA fit, and hand off vetted introductions, not raw leads.

---

## ICP

**Sell-side ICP:** founders/owners of e-commerce and consumer brands, $1M+ EBITDA, US/UK primary, EU secondary. Owners who are exit-curious or actively considering selling.

**Buy-side ICP:** PE firms, family offices, strategic acquirers active in consumer/ecom or generalist lower-middle-market. Decision-maker level depends on campaign variant (Partners, Directors, VP/Associate, Broad/Associate). US/UK primary.

---

## Active Campaigns

| Campaign ID | Name | Side | ICP | Status |
|---|---|---|---|---|
| 496 | Seller Campaign | Sell-side | E-commerce / consumer brand owners | Active |
| 506 | PE Buyer campaign (Ecom) | Buy-side | PE buyers, consumer/ecom focused | Active |
| 507 | PE Buyer campaign (Broad / Associate) | Buy-side | PE associates, broader sectors | Active |

(Older PE Buyer variants — Partners, Directors, VP/Associate, original PE Buyer campaign — kept here for reply-routing only. If they ever re-activate, the same buy-side rules apply.)

---

## Script Rules (for new outbound scripts on this workspace)

- Sender voice is Lukas Maxen, Founder, Maxen Group. First person.
- One question per email. No multi-clause asks.
- "Success-fee only" and "no upfront cost" are core framing on both sides — use them.
- Sell-side hook: "right acquirer for your brand in the next ~3 months, no upfront cost."
- Buy-side hook: "proprietary off-market deals, $1M to $10M EBITDA, success-fee only."
- P.S. opt-out line on every step: "Not relevant? Just let me know and I won't follow up."
- Do not name specific acquirers or specific brands in outbound copy.

---

## Performance (Live Data)

To be populated as the campaigns mature under the Maxen Group brand. Historical Agency Evolution performance (e.g. 29.41% interested on Boutique M&A re-run) is from the retired offer and is not representative.

---

## Items Requiring Clarification

- Confirm exact sell-side fee floor/ceiling once a few mandates close. The 3-6% range is the AI's working answer.
- Decide whether to add a retainer option on buy-side for exclusive sourcing. Current answer is success-fee only.
- Build a short, vetted track-record paragraph for sell-side leads once we have one or two closed deals to reference. Until then, track-record questions route to #manual-replies.

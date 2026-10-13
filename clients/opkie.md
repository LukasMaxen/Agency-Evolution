# Opkie Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client (sourcing, enrichment, campaign strategy, reply management, onboarding), read this file first.
> Sources: Tally onboarding intake (Airtable Onboarding Library, Clients table, record recXW3f9LpYLQpswT, Tally ID 5XrdNzQ, submitted 2026-09-08) and Kasper's client brief (2026-10-13).

## REPLY QUICK REFERENCE

campaign_type: agency / service (not M&A). Growth operations for independent dental and orthodontic practices.
sender: Taylor, Troy or Jeff at Opkie (three sender personas, see {SENDER_EMAIL_SIGNATURE}). Troy Lunt and Jeff take the calls. Always write in first person as the sender on the thread, as part of the Opkie team ("we"). Never refer to the sender in third person. If the sender is Taylor, the call is with Troy or Jeff, so say "our team" for who joins the call, never promise a specific person.
offer: Opkie helps independent dental and orthodontic practices grow from what the practice already has, not from more ads. They recover missed calls, follow up on stalled treatment plans, reactivate lapsed patients and build referral infrastructure. They are NOT a digital agency: no ads, no websites, no SEO as the core offer. Tagline: "The growth you're looking for is already in your practice." First step: a strategy call, online (Google Meet or Zoom).
booking_link: https://link.opkie.com/widget/bookings/opkie-strategy-call
icp: Independent general dentist or orthodontist in the US who owns the practice. Single location or small group, NOT DSO-affiliated. Roughly $800K to $2M annual production, feels the number should be higher, has tried digital marketing with inconsistent results. The owner needs to be on the call (an office manager can join, but not instead of the owner).
proof_points (only these, exact): Musso Family Dentistry, Garland TX: $98,800 in added production in 60 days with zero ad spend, from 4,200 patients who had not been seen in over a year.

reply_rules:
- Lead asks HOW it works: explain plainly that the growth comes from inside the practice, not from new ad spend. Opkie works on missed calls, stalled treatment plans, lapsed patients and referrals. Then offer the booking link for a strategy call.
- Lead asks what makes this different from their marketing agency: Opkie is not a digital agency. They do not run ads, build websites or do SEO. They work on the patients and calls the practice already has. Do not attack the lead's current agency.
- Lead asks for proof, results or a case study: give the Musso Family Dentistry result in plain text (exact numbers above), then the booking link. There is no approved case study link to send.
- Lead asks about pricing or cost: do NOT state any price. The current price is unconfirmed (see Internal Notes). Route to #manual-replies.
- Lead asks about a setup fee, a guarantee or a refund: unconfirmed, route to #manual-replies. Never state a guarantee.
- Lead asks about contracts or commitment: it is month to month, no long-term contract.
- Lead is skeptical because marketing has not worked before: acknowledge it, that is exactly who this is for. The Musso result came with zero ad spend, from patients already in the practice. Offer the strategy call as a low-pressure look at where production is leaking.
- Lead is part of a DSO, has a brand new practice, or has no existing patient base: not a fit. Do not push a call. Route to #manual-replies if unsure.
- Lead is an office manager or practice administrator, not the owner: fine to engage, but the owner needs to be on the call. Say so plainly when offering the link.
- Lead is a consultant, marketing firm or vendor: never contact. No reply.
- Lead proposes a specific time, asks us to send times, or shares their own scheduling link: route to #manual-replies.
- Meetings are online only (Google Meet or Zoom). No phone calls, do not give out any phone number.
- Anything commercial, technical or compliance-related (HIPAA, patient data, integrations with practice software) not listed here: route to #manual-replies.
- If in doubt about anything (tone, what the lead is asking, whether a fact is confirmed here): route to #manual-replies.
- Sign-off: end every reply with {SENDER_EMAIL_SIGNATURE} on its own line. Never type a name as the sign-off, and no "Best" before it.

never:
- Never invent capabilities, results, numbers, client names or case studies beyond the proof_points above.
- Never state a price, setup fee, discount or estimate. Pricing is unconfirmed.
- Never state or imply a guarantee (no "3x ROI", no money-back claim) until Troy confirms the current terms.
- Never describe Opkie as a digital agency, an ad agency or an SEO company, and never offer ads, a website or SEO.
- Never cite the New Orleans or Millcreek accounts with numbers. No figures are on file for them.
- Never suggest specific time slots. Booking link only.

---

## Quick Reference

| Field | Value |
|---|---|
| **Status** | Onboarding In Progress |
| **Website** | opkie.com |
| **Tagline** | "The growth you're looking for is already in your practice." |
| **HQ** | Salt Lake City, UT |
| **EmailBison slug** | `opkie` (DB row created 2026-10-13, EmailBison workspace id 57, workspace token id 399) |
| **EmailBison instance** | `https://send.shieldsoutbound.com` (Shields) |
| **Signed date** | TBD |
| **Monthly retainer** | TBD |
| **Pricing (their offer)** | UNCONFIRMED. Onboarding form: $3,995/month, ad spend included, setup fee $5,000 (reduced to $2,500 if they commit within about 3 days). Website: $2,995/month, no setup fee. Never quote either until Troy confirms. |
| **Active campaigns** | None yet |
| **Airtable base** | Opkie (app7LXrt82RJynd1B), Meetings table tblTnxArHDVMNOxSI. Wired in lib/meetings-tracker.ts 2026-10-13. |
| **Slack channels** | Replies feed C0C9P8C4UCQ (#opkie-replies, raw reply feed, wired) and meetings C0C8NL1K8P5 (#opkie-meetings). Bot is a member of both (verified 2026-10-13). Manual cards go to the global #manual-replies. |
| **Booking tool** | GoHighLevel (LeadConnector), NOT Calendly. Link https://link.opkie.com/widget/bookings/opkie-strategy-call, calendar "(Qualified) Strategy Call" (id BRL34eYzQ16BNOIiLz3F), location vmzEamyXqsd9g2bEFYGu. Token in OPKIE_GHL_TOKEN. Bookings are polled by lib/ghl-poll-sync.ts. No live slots. |
| **Automation tier** | Standard (default). Interested and needs_info replies go to human review. Not confirmed otherwise by Kasper. |

---

## Contacts

| Name | Role | Email | Booking link | Timezone | Notes |
|---|---|---|---|---|---|
| Troy Lunt | Primary contact. Campaign sender and call handler. | troy@opkie.com | https://link.opkie.com/widget/bookings/opkie-strategy-call | US Mountain (Salt Lake City) | Takes calls together with Jeff. |
| Jeff | Campaign sender and call handler. | TBD | Same | US Mountain | Surname and title not provided. |
| Taylor | Campaign sender only. | TBD | Same | TBD | Title not confirmed. Does not take calls. |

---

## Client Overview

Opkie is a fractional growth operations partner for independent general dental and orthodontic practices, based in Salt Lake City. They work directly with the practice owner to increase production, profitability and practice value, aligned to the owner's own goal for the practice (growth, lifestyle, or positioning for a sale).

They are specifically not a digital agency. They do not run ads, build websites or do SEO. They work on what the practice already has: recovering missed calls, following up on stalled treatment plans, reactivating lapsed patients, and building referral infrastructure.

**The system moves from the inside out:** clarify the practice's identity and positioning, tighten internal performance to stop the leaks (conversion, retention, reactivation, referrals), build community presence and word of mouth, then amplify through digital channels. Each layer multiplies the others.

**Their 9-step system:** Answer, Book, Show, Accept, Retain, Reactivate, Expand, Refer, Reach.

**Commitment:** month to month, no contract.

**What they can never say / promise:** nothing provided by the client ("n/a"). Our own rule until Troy confirms: no price and no guarantee in replies.

Qualified lead: owner or founder of a dental or orthodontic practice in the US who shows interest.
Main objection: pricing skepticism.

---

## GTM Brief

### 1. The Offer
See Client Overview. Concrete first step: a strategy call, online, booked through the GoHighLevel link.

Pricing and terms on file (two sources that disagree, see Internal Notes):
- Onboarding form (2026-09-08): flat $3,995/month, ad spend included, no contract. Setup fee $5,000, reduced to $2,500 for practices that commit within a defined window (typically 3 days). 3x ROI within 60 days, guaranteed.
- Website (per Kasper, 2026-10-13): $2,995/month. No setup fee. First month back if not satisfied within 30 days. Month to month, no contract.

### 4. ICP
- Independent general dentist or orthodontist who owns the practice.
- Single location or small group. Not DSO-affiliated.
- $800K to $2M annual production, feels the number should be higher.
- Has tried some form of digital marketing with inconsistent results.
- Owner is actively involved in the business direction and has a clear personal goal (growth, lifestyle, or an eventual sale).
- Office managers or practice administrators may be involved, but the owner must be present on the appointment.
- US based.

Not qualified: DSO practices, brand new practices, practices with no patient base, teams unwilling to participate.

### 6. Proof

| Client | Type | Result |
|---|---|---|
| Musso Family Dentistry, Garland TX | General dentistry | $98,800 in added production in 60 days, zero ad spend, from 4,200 patients not seen in over a year |

Other evidence: accounts from New Orleans and Millcreek on the Opkie evidence page. No numbers on file, so not usable in replies yet.

Case study folder from the intake (internal, not approved to send to leads): https://drive.google.com/drive/folders/1-vdkNIC1r2ouaZ_2nWWP_nnbvBiyvIzj

Referenceable names per intake: all case studies, Opkie, Troy.

What is confirmed working on their paid ads: "Zero ad spend, good production growth." Simple and direct converts. Case studies on the landing page use a deferred decision angle.

### 7. Objections & Reframes
| Objection | Handling |
|---|---|
| Pricing skepticism | Do not quote a price. Point to the Musso result (zero ad spend, from existing patients) and offer the strategy call. A direct price question goes to #manual-replies. |

Full objection bank: not yet provided.

### 8. Language That Works / Doesn't Work
- Do-not-say list: not provided ("n/a" on the intake).
- Never contact: consultants, marketing firms and similar.
- Names never mentioned: n/a.
- Past issues: n/a.
- Compliance requirements: "Not sure" per intake. Treat any HIPAA or patient data question as manual.

---

## Campaigns

None built yet.

Best cold email angle (Kasper, 2026-10-13): lead with $98,800 in 60 days with zero ad spend, positioned as coming from existing patients. A dentist frustrated with marketing spend has little to argue with.

---

## Key Conversations

### Slack Messages
None logged yet.

### Email Conversations
None logged yet.

---

## Internal Notes

- Pricing discrepancy, needs Troy: $3,995/month plus $5,000 setup (form) vs $2,995/month with no setup fee (website). Guarantee also differs: 3x ROI in 60 days (form) vs first month back within 30 days (website). Until confirmed, replies state neither price nor guarantee.
- Still missing: automation tier decision, do-not-say list, full objection bank, compliance details, Taylor's title, Jeff's surname and email, monthly retainer, signed date.
- GoHighLevel token scope: the token can read calendars and appointments only. It cannot read contacts. Bookings made through the booking link carry the lead's email, so they are tracked. Bookings Troy creates by hand inside GoHighLevel have no email on the appointment, so they are skipped until Troy adds the "View Contacts" scope to the private integration.
- Sender profile photo: attached to the Airtable intake record, not verified in EmailBison.

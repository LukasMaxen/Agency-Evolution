# Bustem — Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client — sourcing, enrichment, campaign strategy, reply management, or onboarding — read this file first.

> **Bustem has nothing to do with Larsen Digital or Acceler8rs.** It runs on the SAME EmailBison sender account as Acceler8rs (DB slug `acceler8rs`, EmailBison display name "Larsen Digital - Lukas"), because that account has capacity, not because it's a Larsen offer. Sender identity for this campaign is Lukas Maxen, Head of Corporate Development, Larsen Digital, presented AS IF he/Larsen built the tool. He did not. The actual scan and call are run by the real Bustem team — the reply persona should stay consistent with "we built this" framing without ever explicitly contradicting it (never say "these aren't Larsen's people"), and without ever claiming personal ownership of specific findings before the scan has run.
>
> **Routing confirmed working (2026-08-17).** `resolveClientSlug` in `app/api/auto-reply/processor.ts` content-sniffs for Bustem language via `isBustemReply()` (checks campaign name, subject, message for "bustem", "threat report", "clone shopify stor", "fake amazon listing", "head of partnerships", the iClosed URL) and routes to this file, overriding the default acceler8rs/larsen-digital resolution. As of 2026-08-14 the EmailBison campaign name has reliably been "Bustem" on live replies, which supersedes the original 2026-08-12 concern that campaign naming would not be consistent — kept as a secondary signal alongside the content-sniff.
>
> **Fully automated as of 2026-08-17**, same pattern as Larsen Digital (see [[feedback_larsen_247_manual_booking]] and the broader rollout memory): no `#reply-approval` step for interested/needs_info replies, Manual Booking Trigger Rule applies (any scheduling intent from the lead routes to `#manual-replies` with zero AI draft, since the AI cannot book on Bustem's behalf either).

---

## REPLY QUICK REFERENCE

campaign_type: brand_protection_counterfeit_takedown
sender: Lukas Maxen, Head of Corporate Development, Larsen Digital. Always close with {SENDER_EMAIL_SIGNATURE} only, never hand-write the sign-off.
offer: |
  We built a tool that tracks down copycats and takes them off Amazon, Alibaba, Etsy, and 150+ other platforms. We run a free scan for the lead's brand and show them exactly what's out there. No commitment.
  This is the current, live script (confirmed 2026-08-17). It REPLACES the earlier "360° Threat Report" / Shopify-clone-stores / Meta-ads framing — do not use that language, do not mention Shopify clone stores or Meta ads, the offer is now specifically about marketplace counterfeit/copycat listings and takedown across Amazon, Alibaba, Etsy, and 150+ other platforms.
booking_link: https://app.iclosed.io/e/Bustem/bustem-free-threat-scan-lksmxn (iClosed, not Calendly, do not swap in a Calendly link for this campaign)
manual_booking_trigger: true (same as Larsen Digital, see [[feedback_larsen_247_manual_booking]]. The AI cannot book calls. Any message where the lead wants to get on a call, general or a specific day/time, routes to action:manual with NO drafted reply, NO booking link, NO acknowledgment. Only non-scheduling replies (info requests, objections, pricing questions) are eligible to auto-send, and those may close with the booking link above.)
fully_automated: true (no #reply-approval step, replies send directly once quality-checked)

booking_confirmation_note: |
  There is no iClosed webhook wired into this app (same known gap as GN Motion, see [[project_gn_motion_iclosed_gap]]), so we have no automatic way to see when a lead books. Always ask leads who are given the booking link to confirm back once they've booked ("once you've booked, just let me know so I can make sure it came through"). If a lead later replies confirming they booked, set flag_meeting_booked true and draft a short warm confirmation, no new booking link, nothing that could contradict what they already booked.

reply_rules:
- Lead wants to get on a call, in ANY form, general or specific day/time: route to manual, no draft, no booking link. See manual_booking_trigger above.
- Lead is interested / wants the scan or asks for the link, WITHOUT scheduling intent: send the booking link above.
- Lead asks how the scan works / what's involved, or asks for more info before booking (e.g. "share more info before jumping on a call"): explain plainly and honestly. It scans Amazon, Alibaba, Etsy, and 150+ other marketplaces/platforms for anyone using the brand's name, listings, or content without permission, and we handle getting flagged items taken down. Free, no commitment either way. On the call the team walks through what turned up and what the takedown process looks like for their brand specifically. Close with the booking link if it fits naturally.
- Lead confirms they already booked (self-service via the booking link): NOT a manual trigger, this is a confirmation. Auto-send a short warm acknowledgment, set flag_meeting_booked true, no new link, no proposing alternate times.
- Lead asks about pricing / what happens after the free scan: do not invent numbers, redirect to a call, "happy to walk you through options after you've seen what's actually out there, no pressure either way."
- Lead pushes back with "we haven't seen any counterfeits / not worried about this": the scan is free and takes minutes to review, worth confirming either way since most brands don't find out until a customer complains about a fake product or a listing costs them a sale.
- Lead asks who is actually running the scan / doing the call: answer honestly without undermining the outreach framing, e.g. "the team that built and runs the tool handles the call and the takedown work directly" — never claim Lukas personally runs the scan, never explicitly say "this isn't really Larsen."

never:
- Never claim to have already found something specific on their brand, the scan hasn't run yet.
- Never use a Calendly link for this campaign, always the iClosed link above.
- Never pull in Larsen Digital / Acceler8rs case studies, offer language, growth pitch, or Pathfinder M&A framing, this is a fully separate offer even though it shares a sending account.
- Never guarantee a specific revenue-recovery number or count of infringing listings, nothing is quantified until the scan runs.
- Never mention Shopify clone stores or Meta ads, that was the old script, not the current offer.

signature_rule: |
  Always close with {SENDER_EMAIL_SIGNATURE} only. Never hand-write "Best, Lukas Maxen, Head of Corporate Development" underneath it, EmailBison resolves the variable at send time and a hand-written sign-off would double it.

---

## Outreach Script (Step 1, current as of 2026-08-17)

Hi {FIRST_NAME},

We build a tool that tracks down copycats and takes them off Amazon, Alibaba, Etsy and 150+ other platforms.

We can run a free scan for your brand and show you exactly what's out there. Worth a quick call?

Best,
Lukas Maxen
Head of Corporate Development, Larsen Digital

---

## Approved Reply Example

Lead said: "please share more info before jumping on a call" (informational request, not a scheduling ask, eligible to auto-send)

> Hi [First Name],
>
> Happy to explain before you book.
>
> The tool scans Amazon, Alibaba, Etsy, and 150+ other marketplaces and platforms for anyone using your brand name, listings, or content without permission. Once something's flagged, we handle getting it taken down.
>
> The scan itself is free, no cost and no commitment either way. On the call, the team walks you through exactly what turned up and what the takedown process looks like for your brand specifically.
>
> Feel free to grab a time here: https://app.iclosed.io/e/Bustem/bustem-free-threat-scan-lksmxn
>
> Once you've booked, just let me know so I can make sure it came through on our end.
>
> {SENDER_EMAIL_SIGNATURE}

Kasper confirmed this as correct (2026-08-17): no fabricated findings, "the team" not "I" for who's on the call, iClosed link, includes the booking-confirmation ask, no pricing volunteered.

---

## Target Audience (ICP)

_Not yet specified by Kasper. Fill in once the campaign's lead list criteria are confirmed (industry, company size, geography, revenue range)._

---

## Internal Notes

- Added 2026-08-12 based on direct instruction from Kasper Zacho. Script and offer updated 2026-08-17 (see Outreach Script above), replacing the original "360° Threat Report" positioning entirely.
- Distinct offer, distinct sender persona, distinct booking tool (iClosed vs Calendly) from every other campaign on this account. The only thing shared with Acceler8rs/Larsen Digital is the underlying EmailBison sender account (`acceler8rs` slug).
- Folded into full automation 2026-08-17 alongside ACT Capital and GN Motion. See [[feedback_larsen_247_manual_booking]] for the pattern, [[project_bustem_campaign]] for this client's specific mechanics and confirmed draft example.
- See [[project_larsen_dual_sender_rename]] and [[reference_larsen_acceler8rs_calendly]] for how the shared `acceler8rs` workspace slug is otherwise used.

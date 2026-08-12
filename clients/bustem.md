# Bustem — Brand Protection / Threat Report Campaign

> **New campaign added 2026-08-12.** Bustem has nothing to do with Larsen Digital or Acceler8rs. It runs on the SAME EmailBison sender account as Acceler8rs (DB slug `acceler8rs`, EmailBison display name "Larsen Digital - Lukas"), because that account has capacity, not because it's a Larsen offer. Sender identity for this campaign is Lukas Maxen, Head of Partnerships (not "Co-founder of Larsen Digital", not "Head of Corporate Development").
>
> **ROUTING GAP, NOT YET WIRED IN CODE.** `resolveClientSlug` in `app/api/auto-reply/processor.ts` currently routes every reply on the `acceler8rs` workspace to either `clients/acceler8rs.md` (if campaign name matches `/pathfinder/i`) or `clients/larsen-digital.md` (everything else, the default). There is no branch for Bustem yet, and Kasper confirmed (2026-08-12) the EmailBison campaign name will NOT follow a fixed pattern, so a simple `/bustem/i` regex on campaign name is not safe to rely on. **Until this is resolved, any Bustem reply landing in the auto-reply pipeline on the `acceler8rs` workspace will incorrectly be drafted as a Larsen Digital reply (wrong offer, wrong case studies, wrong Calendly link).**
>
> **Action needed before this campaign goes live and starts getting replies:** get a reliable signal to distinguish Bustem from Larsen/Pathfinder on the same workspace (exact campaign name(s) once known, a dedicated sending domain, a lead-list tag, or content-sniffing on distinctive phrases like "360° Threat Report" / "clone Shopify stores" / "fake Amazon listings"), then add a real branch to `resolveClientSlug` pointing at this file. Flag this to Kasper before the first send if it hasn't been addressed.
>
> **Until the code is fixed:** anyone doing `reply-approval-sweep` or `manual-replies-sweep` on the `acceler8rs` / "Larsen Digital - Lukas" workspace must manually check the campaign name and reply content for Bustem/threat-report language before applying Larsen Digital reply logic. If it's a Bustem reply, draft manually from this file, do not trust the automated draft.

---

## REPLY QUICK REFERENCE

campaign_type: brand_protection_threat_report
sender: Lukas Maxen, Head of Partnerships. Always close with {SENDER_EMAIL_SIGNATURE} only, never hand-write the sign-off.
offer: Free 360° Threat Report. We scan for brand/IP abuse, fake Amazon listings, clone Shopify stores, and Meta ads misusing the brand's content/imagery. No commitment, no cost, just the scan and a walkthrough of what's found.
booking_link: https://app.iclosed.io/e/Bustem/bustem-free-threat-scan-lksmxn (iClosed, not Calendly, do not swap in a Calendly link for this campaign)

reply_rules:
- Lead is interested / wants the report or a call: send the booking link above.
- Lead gives a specific day/time: post to #manual-replies (same rule as every other client, see [[feedback_manual_vs_approval]]).
- Lead asks how the scan works / what's involved: explain plainly, it's a scan across marketplaces (Amazon etc.), Shopify, and Meta ads for unauthorized use of their brand/content, no cost, no commitment, delivered as a report they can act on however they want.
- Lead asks about pricing / what happens after the free report: do not invent numbers, redirect to a call, "happy to walk through options after you've seen what's actually out there, no pressure either way."
- Lead pushes back with "we haven't seen any counterfeits / not worried about this": the report is free and takes minutes to review, worth confirming either way since most brands don't find out until a customer complains about a fake product or a clone site.

never:
- Never claim to have already found something specific on their brand, the scan hasn't run yet.
- Never use a Calendly link for this campaign, always the iClosed link above.
- Never pull in Larsen Digital / Acceler8rs case studies, offer language, or Pathfinder M&A framing, this is a fully separate offer even though it shares a sending account.
- Never guarantee a specific revenue-recovery number, the 8-15% figure is the outreach hook, not a promise for any individual brand.

signature_rule: |
  Always close with {SENDER_EMAIL_SIGNATURE} only. Never hand-write "Best, Lukas Maxen, Head of Partnerships" underneath it, EmailBison resolves the variable at send time and a hand-written sign-off would double it.

---

## Outreach Script (Step 1, as provided by Kasper 2026-08-12)

Hi {FIRST_NAME},

{COMPANY} is probably being copied right now and you don't know it. Fake Amazon listings, clone Shopify stores, Meta ads using your content. Brands lose 8 to 15% of revenue this way.

We offer a free 360° Threat Report, we scan everything and show you exactly what's out there. No commitment.

Worth a quick call to run it?

Best,
Lukas Maxen
Head of Partnerships

---

## Target Audience (ICP)

_Not yet specified by Kasper. Fill in once the campaign's lead list criteria are confirmed (industry, company size, geography, revenue range)._

---

## Internal Notes

- Added 2026-08-12 based on direct instruction from Kasper Zacho. No client file existed before this; created ahead of the campaign going live at Kasper's request, before any leads have been sent or replies received.
- Distinct offer, distinct sender persona, distinct booking tool (iClosed vs Calendly) from every other campaign on this account. The only thing shared with Acceler8rs/Larsen Digital is the underlying EmailBison sender account (`acceler8rs` slug).
- See [[project_larsen_dual_sender_rename]] and [[reference_larsen_acceler8rs_calendly]] for how the shared `acceler8rs` workspace slug is otherwise used, and the routing banner above for why this file isn't wired into the pipeline yet.

# MP Consulting — Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client — sourcing, enrichment, campaign strategy, reply management, or onboarding — read this file first.

> **MP Consulting has nothing to do with AEO Consulting / Austin Heaton's own service.** It runs on the SAME EmailBison workspace as AEO Consulting (DB slug `ah-consulting`), because those sender accounts are already warmed up, not because it's an AEO Consulting offer. Sender identity for this campaign's outreach copy is "Austin Heaton, Marketing Strategist, MP Consulting" (a borrowed identity, same pattern as Bustem borrowing Lukas Maxen's identity on the acceler8rs workspace, see [[project_bustem_campaign]]). **Austin does not take the call for MP Consulting — Maddie does**, via her own Calendly link. Never let a reply imply Austin personally handles the MP Consulting engagement beyond sending the first outreach email.
>
> **Routing (added 2026-09-23, same pattern as Bustem).** `resolveClientSlug` in `app/api/auto-reply/processor.ts` content-sniffs for MP Consulting language via `isMPConsultingReply()` (checks campaign name, subject, message, quoted cold email for "mp consulting", "independent optometry practices", "mpc-maddie", "mackenzie poteat") and routes to this file, overriding the default `ah-consulting` resolution. The same content-sniff is mirrored in `app/api/slack/events/route.ts` (`regenerateReplyDraft`) so a Slack "revise" action on an MP Consulting draft also pulls this file instead of falling back to AEO Consulting's. **Not yet validated against live traffic** — no real MP Consulting replies exist yet as of onboarding (accounts still warming up). Treat as best-effort until confirmed against a real reply, same caveat as Bustem's routing carried at launch.
>
> **Standard automation tier** (default, not fully automated): interested/needs_info replies go to human review in `#reply-approval`, ambiguous ones to `#manual-replies`, same as every client except Larsen Digital, Acceler8rs, and ACT Capital.
>
> **Calendly is plain-link-only for now, no live slot suggestions.** `CALENDLY_CLIENT_CONFIG` (in `lib/calendly.ts`) and the auto-reply slot-suggestion code in `processor.ts` / `slack/events/route.ts` key off `workspace_slug`, which for this campaign is `ah-consulting` — already mapped to Austin's own Calendly account. Adding an entry there would either collide with Austin's real config or wrongly suggest slots off his calendar for MP Consulting leads. Until Maddie's Calendly gets its own integration (separate token, keyed by `mp-consulting` fileSlug rather than workspace_slug — needs a small code change, not just a config entry), replies must only ever share the plain booking link below, never a fabricated or live-suggested time.
>
> **Meeting tracking (2026-09-24): live via polling, not webhook.** Maddie's own Calendly token is stored (`MP_CONSULTING_CALENDLY_TOKEN`), her account is fully separate from Austin's (maddie@mpconsultingfirm.com), and the Airtable base she created ("MP Consulting", `apphW2yI5MyGDOLs9`, "Meetings" table) is wired into `lib/meetings-tracker.ts` under the `mp-consulting` key. Registering a real Calendly webhook subscription failed with `403 Please upgrade your Calendly account to Standard` (her account is on the free tier, which doesn't support webhook subscriptions via the API at all) — worked around this with `lib/calendly-poll-sync.ts`, which polls her account's read-only `scheduled_events`/`invitees` endpoints every 10 minutes (those work on any plan tier) and runs bookings/cancellations through the same tracking pipeline the webhook would have. Per Kasper (2026-09-24), no historical backfill: only bookings made from 2026-09-24 18:00 UTC onward are tracked (`TRACKING_CUTOFF_ISO` in that file). If Maddie upgrades to Calendly Standard+ later, register a real webhook and remove her from `POLL_TARGETS` for instant (not ~10min-delayed) tracking. Still needed: a dedicated Slack `#mp-consulting-meetings` channel (currently falls back to the shared internal alert channel).

---

## REPLY QUICK REFERENCE

campaign_type: agency / service (local digital marketing for optometry practices, not M&A)
sender: Outreach copy signs as "Austin Heaton, Marketing Strategist, MP Consulting" (borrowed sender identity, see note above). **Do not write in first person as if Austin personally runs the engagement or takes the call.** If a lead asks who they'll be speaking with, answer honestly: Maddie.
call_taker: Maddie (not Austin). No confirmation yet on who runs the account after the intro call — flagged as a known gap, see Internal Notes.
offer: |
  MP Consulting is a Nashville, TN based digital marketing agency (operates nationwide, founded 2018 by Mackenzie Poteat) that helps independent optometry practices get found online and turn website visitors into booked appointments. Services: website design, social media management, SEO, reputation management, listings management, digital advertising, email marketing, logo/graphic design, photography/videography, marketing consulting.
  Optometry is the current campaign niche — dedicated optometry-focused positioning, multiple optometry client testimonials, HIPAA-compliant websites. The agency also serves dental, chiropractic, insurance, real estate, salon/spa, interior design, restaurant, and hospitality clients more broadly, but do not pivot the pitch to those verticals unless the lead's own business is clearly one of them and asks.
booking_link: https://calendly.com/mpc-maddie/mpc-interview-call-20-min-clone (plain link only, see note above on why no live slot suggestions yet)
call_format: Phone or video both fine, no preference to push.
pricing_model: |
  Flexible (hourly, monthly, or project-based). Three tiers, not yet confirmed as a specific cold-email entry offer:
  - Tier 1 (small local business, 1-10 employees): $1k-$3k
  - Tier 2 (regional business, 11-50 employees, CMO/Marketing Director): $3k-$20k
  - Tier 3 (enterprise national brand, 50+ employees): $20k-$100k
  If a lead asks for a specific number, do not quote one of these ranges as a committed price without knowing which tier they fall into — direct to the call, this is one case where deflection is appropriate because pricing genuinely depends on scope, not because the fact is undocumented.
icp: |
  Three segments (see pricing_model above for matching budget tiers):
  1. Small local Nashville-area businesses, 1-10 employees
  2. Regional businesses, 11-50 employees, decision-maker is CMO/Marketing Director
  3. Enterprise national brands, 50+ employees
  Current campaign focus is optometry practices specifically, across all three size tiers.

reply_rules:
- Lead is interested / asks for a call: share the booking link above, plain link, no suggested times, no live slots.
- Lead asks who they'll be talking to: answer honestly, Maddie. Never imply Austin Heaton personally runs the call or the account afterward, that is unconfirmed and would misrepresent the sender identity, see note above.
- Lead asks for proof/case studies: only use confirmed proof points (see Proof Points below). No specific ROI/revenue/lead-volume numbers exist yet, do not invent any, all case study numbers are currently NA.
- Lead asks about pricing: use pricing_model above only to describe the tier structure and ranges if it naturally fits, never commit to one number without knowing their size, redirect the specific figure to the call.
- Lead asks about HIPAA compliance / data handling: the only confirmed fact is that MP Consulting builds HIPAA-compliant websites for optometry clients. Do not elaborate beyond that into specific compliance mechanisms, none are documented.

never:
- Never invent case study numbers (CTR%, revenue, leads generated) beyond the one confirmed proof point below. All others are marked NA until Kasper/Maddie supply them.
- Never claim Austin Heaton personally handles the MP Consulting account, call, or ongoing work. He is the outreach sender identity only.
- Never quote a specific price without qualifying it by business size/tier, and never present any of the three ranges as fixed for a lead whose size is unknown.
- Never suggest specific call times or claim live calendar availability, the booking link is plain-link-only until Calendly is properly wired for this campaign (see note above).
- Never fabricate a "qualified lead" definition, an objection-bank answer, or a do-not-say item not documented here, if genuinely unsure route to `#manual-replies` instead of guessing.

signature_rule: |
  Always close with {SENDER_EMAIL_SIGNATURE} only, resolved by EmailBison at send time for the Austin Heaton sender identity used on this campaign. Never hand-write a sign-off underneath it.

---

## Outreach Script (Step 1, current as of 2026-09-23)

Hi {FIRST_NAME},

We help independent optometry practices get found online and turn website visitors into booked appointments.

Worth a quick call?

Best,
Austin Heaton
Marketing Strategist, MP Consulting

---

## Proof Points (confirmed)

- Google PPC campaign for COUG Public Relations: 20-30% CTR, expanded the client from Ohio to four states. (Only proof point with any specific number — safe to reference as-is, do not embellish further.)
- ProMove Chiropractic: website design testimonial (qualitative, no numbers attached).
- Multiple optometry practice testimonials exist but no specific client names or numbers confirmed yet.
- Implied 5.0 Google review rating — not independently confirmed, treat as directional only, do not state as a hard fact if pressed for a source.

---

## Target Audience (ICP)

See `icp` in REPLY QUICK REFERENCE above. Current live campaign: independent optometry practices, all three size/budget tiers.

---

## Internal Notes

- Onboarded 2026-09-23 based on intake from Kasper Zacho. Uses AEO Consulting's existing warmed-up EmailBison workspace (`ah-consulting`) for sending capacity while MP Consulting's own accounts warm up — no new DB row, no new EmailBison workspace, no new webhook registration needed. Routing to this file is handled entirely by content-sniffing (see `isMPConsultingReply` note above), not by workspace slug or a `CLIENT_FILE_ALIASES` entry.
- **Standing gaps, flagged to Kasper at onboarding, needed before scripting/reply guidelines can be as strong as they should be:**
  - No case studies with specific numbers beyond the one COUG Public Relations CTR stat — everything else marked NA.
  - No confirmed sender details beyond Maddie's name (no confirmed email address for her, no confirmed profile photo).
  - No qualified-lead definition from the client.
  - No objection bank.
  - No do-not-say list beyond what's inferred here (no invented numbers, no overstated compliance claims).
  - No compliance details beyond "HIPAA-compliant websites" as a bare fact.
  - No pricing confirmed as a specific cold-email entry offer (three tiers exist but no single number to lead with).
  - No confirmation of who runs the account/relationship after Maddie's intro call.
  - Meeting tracking: Calendly token + Airtable base now provided (2026-09-24) and wired into `lib/meetings-tracker.ts`, but not live — Maddie's Calendly account needs to be upgraded to Standard before the webhook can be registered (see note above). No dedicated Slack meetings channel yet either.
- Full GTM/campaign-copy interview (`1. Departments/operations/SKILL_IntakeClient.md`) not yet run — this file only covers what's needed to route replies correctly and avoid fabrication, not the full case-study/psychological-driver brief.

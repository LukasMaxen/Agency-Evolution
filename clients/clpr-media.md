# CLPR Media Client File

> This is the single source of truth for everything about this client.
> When working on any task for this client (sourcing, enrichment, campaign strategy, reply management, onboarding), read this file first.
> Sources: Tally onboarding intake (Airtable Onboarding Library, Clients table, record recZtqPWvKuzn6Hxd, Tally ID kbgBL5J, submitted 2026-09-11) and Kasper's client brief (2026-09-28).

## REPLY QUICK REFERENCE

campaign_type: agency / service (not M&A). Short-form video clipping and distribution.
sender: Kevin Clavell, co-founder, CLPR Media (sender name "Kevin | CLPR Media"). Kevin takes every call himself, so always write in first person as Kevin, never refer to "Kevin" in third person.
offer: CLPR Media turns long-form content and raw footage into short-form clips for TikTok, Instagram Reels, YouTube Shorts and Facebook Reels. Two options: Community Clipping (a network of 8,000+ clippers creates and distributes clips across thousands of independent accounts at the same time, built for reach) and In-house Clipping (tighter control over quality, strategy, branding and posting on the client's own pages, better for brands that care about consistency and brand safety). First step: a 30-minute online call.
booking_link: https://calendly.com/clprmedia/30min
icp: Founder-led creators, podcasts, streamers, lifestyle influencers, music artists/labels, consumer brands and tourism/destination brands that already have long-form content or raw footage. Strongest cold email fit: ecom and beauty brands. Founder must be willing to be on camera weekly.
case_study_link: https://docs.google.com/document/d/1w-viPxIh3RYzlPUysM0bwGFlMz7ougZmf03Q8gl7nKA/edit?usp=sharing
proof_points (only these, exact, they match the case study PDF): The Koerner Office, Chris Koerner's business podcast: 16 dormant accounts revived, 29.3M views in 6 months from the done-for-you retainer plus 15.9M from a clipper community campaign. Albino, an upcoming Spanish-language music artist: 1.6M views from the clipper community, top clip 366K views. A lifestyle brand (confidential, never name it): 1.8M views from a 1-week clipper campaign. 48.6M total views, 2,700+ unique clips, 8,000+ clippers. Based Bodyworks (DTC ecom brand, not under NDA) may be named as a client but has no numbers on file.

reply_rules:
- Lead asks HOW it works: explain the two models plainly (Community Clipping for reach, In-house Clipping for control and brand safety), then offer the Calendly link.
- Lead is a brand (ecom, beauty, DTC, supplements, etc.): lead with In-house Clipping. Relevant proof: the 1-week lifestyle brand test (1.8M views), and Based Bodyworks as a named client.
- Lead is a creator or podcast: The Koerner Office is the relevant proof point (29.3M views in 6 months from the retainer).
- Lead is a music artist / label: mention clipping existing footage (music videos, studio, tour, BTS) and distribution through the clipper network to push a release. Albino (1.6M views, top clip 366K) is the relevant proof point.
- Lead is a tourism board / destination: frame it as making existing footage feel native to social rather than corporate.
- Lead asks about pricing (first time): do not give a number. Say it depends on content volume and goals, that Kevin maps out exactly what we would do and what it would cost on a short call, then offer the Calendly link.
- Lead insists on pricing before a call (asks again, or refuses a call without a number): say pricing starts at $5,000/month, then offer the call. Never give any other price, tier or package detail.
- Lead asks about guarantees, add-on pricing, or anything else commercial not listed here: route to #manual-replies.
- Lead asks for a case study, examples or results, or says yes to one being offered: send the case_study_link above with one line on the most relevant case for them, then the Calendly link. Do not restate the whole PDF. Do not send it again if it is already in the thread.
- Lead says they already have a content system: this is NOT qualified per the client. Treat as not interested, no reply.
- Meetings are online only (no phone calls).
- Sign-off: end every reply with {SENDER_EMAIL_SIGNATURE} on its own line. Never type "Kevin" or any name as the sign-off, and no "Best" before it (Kasper, 2026-09-30).

never:
- Never invent capabilities, results, view counts, client names or case studies beyond the proof_points above.
- Never volunteer pricing. Only say "starts at $5,000/month" when the lead insists before a call, never any other price. No tiers, package names, video counts, view guarantees, CPMs as a price quote, or add-on pricing.
- Never promise revenue results or refunds.
- Never suggest specific time slots. Calendly link only.

---

## Quick Reference

| Field | Value |
|---|---|
| **Status** | Onboarding In Progress |
| **Website** | clprmedia.co |
| **Tagline** | "Be everywhere. All at once." |
| **EmailBison slug** | `clpr-media` (DB row created 2026-09-28) |
| **EmailBison instance** | `https://send.shieldsoutbound.com` (Shields) |
| **Signed date** | TBD |
| **Pricing (their offer)** | Avoid until the call. If the lead insists beforehand: starts at $5,000/month |
| **Sender domains** | 400 Kevin inboxes, all Microsoft (Outlook), so not shown in Account Monitor (Google-only by design). 100 each on clprmedialab.com, clprmediacentral.com, clprmedianetwork.com, clprmediateams.com (checked 2026-09-29) |
| **Active campaigns** | AE \| E-commerce Brands (id 732) and AE \| Beauty Brands (id 730), both active and sending as of 2026-09-28. Older CLPR Media campaigns (Medspas, Real Estate, Venues, Health, F&D, Fashion, Ecom, SAAS) are paused, completed or archived. |
| **Airtable base** | CLPR Media (applnvVcAGLchrG2b), Meetings table tblTnxArHDVMNOxSI, CRM - Outbound table tble5jOq2n1zXSKIy |
| **Slack channels** | #clpr-media-replies (C0C4GPN1PUP, raw reply feed) and #clpr-media-meetings (C0C5SFSTQ0G, meetings tracker). Approval cards still go to the global #reply-approval and #manual-replies. |
| **Calendly** | Token in CLPR_MEDIA_CALENDLY_TOKEN. Free plan, so no webhook: bookings are picked up by lib/calendly-poll-sync.ts every 10 min (tracking from 2026-09-28 15:30 UTC, no backfill). One event type: "CLPR Media Discovery Call". |
| **Automation tier** | Standard (interested/needs_info go to human review) |

---

## Contacts

| Name | Role | Email | Calendly | Timezone | Notes |
|---|---|---|---|---|---|
| Kevin Clavell | Co-founder. Video editing expert, YouTube strategist (150k subscribers, 100M+ organic views across faceless YouTube channels). Leads campaign playbooks and viral hook strategy. Sender and call handler. | clprmedia@gmail.com | https://calendly.com/clprmedia/30min | US Eastern (Cleveland, Ohio area) | Primary contact for us. Online meetings only. |
| Raul Vega | Co-founder. Post-production specialist with music artist experience. Oversees QA and creative direction. | TBD | | TBD | |

---

## Client Overview

CLPR Media helps creators, music artists, brands, podcasts and official tourism authorities repurpose long-form content and raw footage into short-form videos built for attention and distribution across TikTok, Instagram, YouTube Shorts and Facebook Reels.

- **Community Clipping:** 8,000+ clippers (via Whop) create and distribute clips at scale across thousands of independent accounts simultaneously. Built for reach.
- **In-house Clipping:** tighter control over quality, strategy, branding and posting on the client's own pages. Better for brands that care about consistency and brand safety.

Add-ons (no pricing to be shared):
- **Production:** CLPR supplies talent, crew and camera.
- **Commerce for CPG:** TikTok Shop setup, shop management, affiliate engine, LIVE selling.
- **Performance pricing for CPG:** exists, details not for replies.

Client requirements: films on schedule, approves within 48 hours, keeps account access live.

Qualified lead: matches ICP and shows interest.
Not qualified: already has a content system.
Key requirement: founder must be willing to be on camera weekly.

---

## GTM Brief

### 1. The Offer
See Client Overview. Concrete first step: 30-minute online call via Calendly. Pricing is discussed on the call. If a lead insists beforehand: starts at $5,000/month.

### 4. ICP Personas
Client's summary: "Basically anything founder led." Must already have long-form content, raw footage or a large catalog.

1. **High-output creators.** Large existing catalog or 2+ long-form videos per week.
2. **Podcasts.** Posting more than once per week or large back catalog.
3. **Streamers.** Established, high-income, consistent content and existing audience. Not new streamers.
4. **Lifestyle influencers.** Vlogs, BTS, travel, lifestyle, personal brand content.
5. **Music artists and entertainment.** Artists, labels, managers, producers, DJs, festivals, venues.
6. **Brands.** DTC, ecom, beauty, supplements, creator-led, fitness, finance, automotive, gambling. In-house offer is strongest here.
7. **Tourism authorities and destination brands.** Tourism boards, state travel offices, city destination teams, hotels, resorts.

**Best for cold email: ecom and beauty brands** (proven by Shields campaign data below).
Avoid: fashion and food and drink (high replies, near zero buying intent).
Geography, titles, company size, revenue range: TBD.

### 6. Proof Points & Case Studies
Case study (Google Doc, "How we turn creators into content engines", same content as the earlier PDF, replaced it 2026-09-30): https://docs.google.com/document/d/1w-viPxIh3RYzlPUysM0bwGFlMz7ougZmf03Q8gl7nKA/edit?usp=sharing
- **The Koerner Office (Chris Koerner, business podcast, 4 sub-brands, 16 accounts, all dormant at start).** Done-for-you, 6 months: 29.3M views, 695 unique clips, 2,780 posts. Clipper community campaign in parallel: 15.9M views, $0.29 effective CPM, $4,687 paid to clippers. Best clips: uncommon business ideas, weird-but-real business models, Chris in explain mode.
- **Albino (upcoming Spanish-language music artist).** Clipper community: 1.6M views, $0.46 CPM, $750 paid to clippers, top clip 366K views.
- **Confidential lifestyle brand (under NDA, never name).** 1-week clipper test: 1.8M views, $0.55 CPM, $1,000 budget, 1,322 clip submissions, 374 unique creators.
- **Totals:** 48.6M views, 2,700+ unique clips, 8,000+ clippers.
- **Based Bodyworks:** DTC ecom brand, named in the brief as a client, not under NDA (confirmed by Kasper 2026-09-28), no numbers on file.
- Numbers locked by Kasper 2026-09-28: always use the PDF figures above. The brief's "Chris Koerner, 35M views" and "50M+ total views" are superseded, never use them.
- Network of 8,000+ clippers via Whop.

### 7. Objections & Reframes
| Objection | Handling |
|---|---|
| "We already have a content system." | Not qualified per client. No reply. |

Full objection bank: not yet provided.

### 8. Language That Works / Doesn't Work
- Do-not-say list: blank from client (our global rules still apply).
- Compliance requirements: none.

---

## Campaigns

### Prior performance (Shields campaign)
- 66,243 contacted, 69 interested (0.10%).
- Best: Ecom (12 interested), Beauty (9 interested).
- Worst: Fashion, F&D. High replies, near zero buying intent.
- Biggest issue: data quality and bounce rates.

---

## Key Conversations

### Slack Messages
None logged yet.

### Email Conversations
None logged yet.

---

## Internal Notes

- Still missing: full objection bank, sender profile photo confirmation.
- Separate tools offer from the intake: disregarded per Kasper 2026-09-28, never mention it.

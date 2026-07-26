# Architecture Notes

Design decisions and data-source facts that shape how features get built. Not rules for Claude to follow during a single task — load-bearing constraints for new work.

---

## Clients are boutique M&A firms (often solo)

Maxen's clients are boutique M&A intermediary firms, typically run by one person. The "owner" and the "advisor" are usually the same human. Some firms have two people, rarely more.

**Implication for new features:** use a 2-role auth model only — `maxen_admin` and `client`. Do not pre-build owner-vs-advisor splits, lead-assignment hierarchies, or "manager sees all advisors" views unless explicitly requested. Scale by adding more `client` users to the same workspace if a firm hires a second person.

---

## meeting_booked source of truth = CRM

Meeting-booked status is being wired to come from the CRM (not EmailBison) as the authoritative source. Started 2026-05-06.

**Implication:**
- Do not propose an EmailBison `CONTACT_MEETING_BOOKED` webhook handler as the meeting_booked sync path. The CRM integration replaces it.
- Existing paths still apply: Calendly webhook and manual booking via `/api/calls` set `meeting_booked = TRUE`. The CRM connection will be the third and primary input once live.
- When asked about meeting_booked accuracy, point at the CRM integration as the source of truth.
- Ask for the CRM name and webhook/API contract before implementing the sync.

**Why:** EmailBison's meeting-booked tag is manual and inconsistent. The CRM is where booked meetings actually land (post-Calendly, post-call), so it's the cleanest source.

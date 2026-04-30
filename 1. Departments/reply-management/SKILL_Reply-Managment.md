# Skill: Handle Inbound Reply

## What this skill does
Drafts a reply to an inbound lead who has responded to a cold email. Classifies their intent, selects the right response strategy, and writes a ready-to-send email. Also handles follow-up drafts when a lead has gone quiet after expressing interest.

---

## When to run this
- A lead has replied to any campaign and you need to respond
- You need to classify a reply before deciding how to respond
- You need to draft a specific FU step for a lead who expressed interest but hasn't booked
- A lead has come back after going quiet and you need to re-engage

---

## How to run
Ask Claude:
> "Draft a reply to this lead: [paste the lead's email]" — always include the client name
> "This lead asked for more info about the franchise — draft a reply for 911 Restoration"
> "Classify this reply and write a response: [paste email]"
> "Lead for ACT Capital said they're not in the market right now — how do we respond?"
> "Draft FU2 for [lead name] under Wrobel Capital"
> "Lead for GN Motion asked to be removed — what do we do?"

---

## What Claude will do

1. Read `clients/[client-slug].md` for tone, offer details, calendar link, objection handling, and FU templates
2. Read `1. Departments/reply-management/CONTEXT_Replies.md` for global reply rules
3. Classify the reply intent: `interested_urgent | interested | needs_info | neutral | not_interested | unsubscribe`
4. Select the correct response strategy based on intent and client profile
5. Draft the reply — prose only, matched to the lead's message length
6. Include the correct calendar link for the sender (from the client file)
7. Flag if the lead should be marked `unsubscribe` or `meeting_booked` in the system

---

## Output format

**Intent classification:** [intent value]
**Urgency:** [high / medium / low]
**Recommended action:** [send reply / start FU sequence / stop sequence / mark unsubscribe]

**Draft reply:**
Subject: Re: [original subject]

Hi [First Name],

[reply body]

[Sender Name]

---

## Rules Claude must follow
- Read the client file before drafting — never assume tone or offer details from memory
- Match reply length to the lead's message — short reply = short email
- Always include the client's Calendly link in replies to interested leads
- Never use em dashes, never use bullet points in short replies
- Never volunteer pricing unless the lead explicitly asks
- Mark as unsubscribe immediately if the lead says "remove me", "unsubscribe", or "not interested"
- When a lead books: confirm in 2–3 lines max, flag to stop the FU sequence
- When drafting a FU step: use the client's FU templates from their client file if available

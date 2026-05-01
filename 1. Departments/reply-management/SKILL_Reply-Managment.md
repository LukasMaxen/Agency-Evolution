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

{SENDER_EMAIL_SIGNATURE}

---

## Campaign Type Check — Do This First

Before drafting any reply, identify the campaign type. Three types exist:

| Campaign Type | Who We're Emailing | Our Role | Goal of Reply |
|---|---|---|---|
| **Sell-Side Mandates** | PE firms, strategic buyers, investors | We represent a company for sale | Send teaser + get them on a call |
| **Acquisition Outreach** (Wrobel/Statera/ACT) | Business owners | We represent a buyer looking to acquire | Get the business owner on a call |
| **SDR / Agency Evolution** | M&A advisors, boutique banks | We offer deal origination services | Get them on a call to pitch our service |

**If it's a Sell-Side Mandate campaign:**
1. Check the client file for active mandates and match to the correct one using trigger keywords
2. Prospect interested or asks for more info → send the correct teaser + calendar link
3. Prospect asks about price/valuation → stay vague, redirect to teaser and call ("Best discussed on a call")
4. Prospect asks who the seller is → NDA framing: not able to share before NDA is in place
5. Prospect not a fit → polite exit, 2–3 lines max
6. Prospect tries to route through an intake form → clarify we are the advisor, not the company

Active mandate clients: **ACT Capital** (3 mandates), **Venture Exits** (Yoga & Wellness), **ZEBS/Statera** (Seed Round). Read those client files for teaser links and reply templates.

**Always send the teaser** when replying to any interested lead on a mandate acquisition campaign, regardless of what they asked. Even if redirecting to a call, include the teaser as a "in the meantime" add. No exceptions.

---

## Rules Claude must follow
- Read the client file before drafting — never assume tone or offer details from memory
- Match reply length to the lead's message — short reply = short email
- Always include the client's Calendly link in replies to interested leads
- Never use dashes of any kind — no em dashes, en dashes, or punctuation dashes. Restructure the sentence instead.
- Never use bullet points in short replies
- Never volunteer pricing unless the lead explicitly asks
- Mark as unsubscribe immediately if the lead says "remove me", "unsubscribe", or "not interested"
- When a lead books: confirm in 2–3 lines max, flag to stop the FU sequence
- When drafting a FU step: use the client's FU templates from their client file if available
- Always end with {SENDER_EMAIL_SIGNATURE} on its own line — never write "Best," or a name before it
- Always use a blank line between paragraphs — never run text into one block

---

## When to Post to #manual-replies

**Larsen Digital:** Always send the Calendly link. Never post to #manual-replies.

**Every other client:** When a lead says yes to a call, wants to discuss, asks when we are free, or confirms interest in speaking — post to #manual-replies. Do NOT send a Calendly link. The team books manually.

Do NOT post to #manual-replies for:
- Redirects to a new contact (e.g. "Arnaud is no longer here, contact g.mamboundi@...") — draft a reply and send directly to the new email via toEmailOverride
- General interest replies — just respond normally
- Ambiguous replies — draft and send, do not escalate

---

## Process Rules — Before Drafting Any Reply

1. **Check the interested flag.** Only reply to leads marked `interested = true` in the system. Do not reply based on message content alone.
2. **Check excluded clients.** Hahnbeck, ITG Group, and Sonaro AI are excluded from all replies — the client handles directly. Do nothing for these workspaces.
3. **Read the full thread.** Check what has already been sent to this lead. Do not repeat stats, stories, links, or value props already in the thread.
4. **Adapt to the message.** Never paste a template that doesn't match what the lead actually said. If they asked for a call, lead with booking the call. If they asked for info, lead with the info. The template is a starting point, not a script.

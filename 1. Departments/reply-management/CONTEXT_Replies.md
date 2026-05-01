# Reply Management Context — Rules & Patterns

*Cross-client rules for handling inbound replies. Apply to all clients regardless of campaign type.*

*Client-specific context (offer, calendar link, objection handling, FU templates) lives in `clients/[slug].md`.*

---

## The Process

1. **Lead replies → interested** — send the info reply + Calendly link. Use the client's Calendly link from the client file.
2. **Lead books a call** — send confirmation. Mark `meeting_booked = TRUE` in DB.
3. **Lead replies → interested but no booking** — start follow-up sequence (FU1 → FU10).
4. **No response after any FU** — wait 7 days, send next FU in sequence.
5. **Lead unsubscribes or says hard no at any point** — stop immediately. Do not follow up.
6. **Lead books after a FU** — stop sequence, send confirmation.

_Info reply templates and FU templates for each client live in `clients/[slug].md`._

---

## Follow-Up Sequence Structure

Tone progression applies across all clients unless the client file says otherwise:

- **FU1–FU3:** Warm, informative — reference the original interest
- **FU4–FU6:** Shorter, more direct — mild urgency
- **FU7–FU9:** Very short, low pressure — keep door open
- **FU10:** Close the loop, leave on good terms. Never signal it is the final email.

Spacing: 7 days between each FU unless client file specifies otherwise.

---

## Confirmation Email

Used across all clients when a lead books a call. Swap in the relevant day, time, and sender name.

**Subject:** Confirmed — [Day, Date] at [Time]

**Body:**

Hi [First Name],

Perfect — confirmed for [Day, Date] at [Time]. You will receive a calendar invite shortly.

Looking forward to speaking.

[Sender Name]

---

## Tone & Style

- Human, natural, conversational — not corporate or AI-sounding
- Short and direct — no fluff, no padding
- No over-eager or sycophantic phrases
- No dashes of any kind — no em dashes (—), en dashes (–), hyphens used as punctuation, or double dashes (--). Avoid dashes in general. Restructure the sentence instead.
- No bullet points or numbered lists unless structuring a multi-part answer to a direct question
- No "Sounds great!" or overly casual openers
- Avoid: "genuinely", "straightforward", "excited to", "thrilled", "delighted"
- Closings: "Looking forward to speaking with you" / "Looking forward to it" — keep it simple

---

## Formatting Rules

- Prose over lists wherever possible
- One calendar link per email, placed naturally near the closing
- No bare URLs on their own line — always give a link context ("Feel free to grab a time here: [link]")
- Subject lines: short, contextual (e.g. "Re: Buyer for ORPC", "Re: Acquisition Interest")
- Signatures: always end with {SENDER_EMAIL_SIGNATURE} on its own line. Never write "Best," or "Best regards," or any name before it. The variable resolves to the full sender signature on send.
- Always use a blank line between each paragraph. Never run sentences together into one block.

---

## Content Rules

- NEVER mention pricing unless the prospect explicitly asks
- NEVER confirm or deny valuation/EV numbers upfront — keep vague, pull to call
- NEVER agree to commission-only structures — politely decline and close
- NEVER over-promise on buyer capabilities before a call
- ALWAYS include the client's Calendly link in replies to interested leads
- ALWAYS research the prospect company when they ask questions requiring context
- Use NDA framing when asked about buyer identity: "standard practice to protect both sides"

---

## Reply Drafting Rules

- Match reply length to the prospect's message — short reply = short email
- When prospect says "yes" or books: reply is 2–3 lines max
- When prospect asks for info: answer concisely then redirect to a call
- When prospect has an objection: reframe it as a reason to talk, not dismiss it
- When prospect is clearly not a fit: exit cleanly and professionally in 2–3 lines
- When redirected to another contact: acknowledge and email that contact directly, use the referral as the opener
- Address all CC'd people in the reply (e.g., "Hi Melanie, Alex")
- Match the language of the correspondence — French reply = French email

---

## Objection Handling Patterns

| Objection | Response Strategy |
|---|---|
| "We're not for sale" | Acknowledge, keep door open, reframe as exploratory |
| "We're not in your revenue range" | Reframe valuation as a planning tool, still push for call |
| "Who is your buyer?" | NDA standard practice framing, call is the next step |
| "What's your fee?" | Answer honestly, never volunteer if not asked |
| "What's a ballpark valuation?" | Can't answer without knowing more → pull to call |
| "Send me a company profile/proposal" | Brief context + redirect to call instead of sending a document |
| "Commission-only" | Politely decline, not our model |
| "I prefer to handle via my assistant" | Acknowledge, offer calendar link, address assistant directly |
| "Already have distribution / not in market" | Pivot to adjacent service where applicable |
| "Not the right time" | Acknowledge, ask when to follow up, add to FU sequence |
| "Send me more info / a deck" | Send materials if available, follow up in 7 days if no response |
| "Already working with someone" | Politely acknowledge, keep door open, do not push |

---

## Language Patterns That Work

- "Worth a quick call to go through the details."
- "Easier to walk through on a call than in an email."
- "A 30-minute call is really just to see if there's a fit."
- "No pressure or commitment involved."
- "Capital is in place and they are ready to move."
- "Before they engage another advisor."
- "No signed mandate, no fee."

## Language Patterns to Avoid

- "Is exactly the kind of targeting we can build around"
- "Gives us a clear brief to work with"
- "We are proud to represent"
- "I'm excited to show you"
- "Sounds great!"
- "I hope that works for you"
- Any phrase that sounds written by AI or a salesperson trying too hard

---

## Behavioral Rules

### Always
- Include the correct calendar link for the sender in every reply to an interested lead
- Research the prospect's business when they ask questions requiring context
- Match the language of the correspondence (French reply → French email)
- Use the referral name as the opener when reaching out via a warm intro
- Address all CC'd people in the reply
- Use NDA framing for buyer identity questions in M&A contexts

### Never
- Use em dashes
- Use bullet points in casual/short replies
- Over-explain or pad out a short "yes" reply
- Volunteer pricing unprompted
- Agree to commission-only structures
- Confirm or deny a valuation before a discovery call
- Use AI-sounding phrases or overly enthusiastic language
- Ask multiple clarifying questions — just draft and proceed

---

## Getting Prospects on a Call

1. Short reply = short ask. If they said yes in two words, reply in three lines.
2. Reframe objections as reasons to talk. "That's exactly why a call makes sense."
3. Use urgency sparingly. "Buyers are active in your space right now" — only when true.
4. Mirror their language. If they're formal, be formal. If casual, be casual.
5. Redirect document requests to calls. "Better to walk through this together than send a generic deck."
6. Use warm intros. Always open with the referrer's name when one exists.

## Scheduling Emails
- Confirm the time, send the invite, offer rescheduling link — three lines max
- If prospect gave availability, use it; don't ask again
- Prefer Google Meet when specified by the sender

## Multi-Language Emails
- Match the language of the prospect's reply exactly
- French emails: use "Bien cordialement" or "À très vite" as closings
- Keep the same brevity and directness regardless of language

## Internal Updates (Slack / Teams style)
- Keep it factual and concise
- No corporate padding
- Lead with what happened, then what's next

---

## Stop Rules

- Lead says "remove me", "unsubscribe", "not interested" → stop immediately, no exceptions
- Lead goes silent after FU10 → close the sequence, do not contact again unless they re-engage
- Lead books a call at any point → stop FU sequence immediately
- Lead says "follow up in X months" → pause sequence, resume at the date they specified

---

## Scheduling: When to Send Calendly vs. Book Manually

**Larsen Digital exception:** Always send the Calendly link for Larsen Digital, even when the lead mentions specific availability or a preferred time. Never book manually for this client. Find a natural reason to send the link instead (e.g. "easiest way to lock something in", "calendar fills up fast"). The excuse must feel genuine. This rule applies to Larsen Digital only.

**Send Calendly link** when the lead expresses general interest and says "happy to jump on a call" or "let me know when you're free" — let them self-schedule.

**Book manually** (go into the sender's calendar, find an open slot, create the event, then reply confirming it) when:
- Lead gives a specific day or window: "Wednesday afternoon CET", "Monday works", "next week"
- Lead says "send me a calendar invite" or "pick your slot"
- A meeting link broke and you need to reschedule immediately
- Lead is confirming a time already proposed

**Manual booking reply pattern** (confirmed by real sent emails):
> Hi [Name],
>
> Sounds great. I've gone ahead and booked a placeholder for us to speak on [Day] at [Time].
>
> Could you please confirm that you received the calendar invitation? If the time does not work, you can easily reschedule using the link in the invite.
>
> Looking forward to our conversation.

Do NOT send Calendly and ask them to "pick a slot" when they've already given you a window. Check the calendar, pick the time, book it. Put the ownership on you, not them.

---

## Scenario Library — Real Examples

*Drawn from live workspace data. Use these as pattern references when drafting replies.*

---

### 1. "Open to a conversation" — Generic Interest

**Lead message:** "Hi, a sale is not something we have considered at this time but we are open to an exploratory call on Monday if you have availability."
*(Mauricio, ShredPay — ACT Capital)*

**Response pattern:** Short, warm, lock in the day they offered. Ask for time + format. 2–3 lines max.

> Hi Mauricio,
>
> Monday works well. What time suits you, and do you prefer a call or video?
>
> Looking forward to it.

**Flag:** Lead offered a specific day (Monday) → book manually if they give a time, or confirm via Calendly.

---

### 2. "Send me the teaser / more info"

**Lead message:** "Send it! Not sure it's a fit but let's see the teaser."
*(Grant, Napkin Inc. — Venture Exits)*

**Lead message (alt):** "Yes, please send me the teaser."
*(Shamus Dailey, Sojourner Consumer Partners — ACT Capital)*

**Response pattern:** Confirm you're sending it, brief framing of why it's interesting, offer a call to follow up. Don't oversell.

> Grant, sending it now. Take a look and let me know if it raises any questions worth a call.

**Flag:** After sending, add to 7-day follow-up sequence if no response.

---

### 3. "Not in your range but open to talking"

**Lead message:** "As of right now, we're not doing that level of volume, so it doesn't meet the criteria you outlined. That said, it's a small ecommerce business with clear potential to grow to those numbers with the right team in place. If that's of interest, I'm open to a conversation."
*(Theresa, KetoBars.com — Hahnbeck)*

**Lead message (alt):** "a sale is not something we have considered at this time but we are open to an exploratory call"
*(Mauricio, ShredPay — ACT Capital)*

**Response pattern:** Acknowledge the gap, frame the call as exploratory rather than a commitment. Don't bend on what the buyer wants — just open the door.

> Hi Theresa,
>
> Appreciated the context. The entry point is exactly what makes a conversation worth having — easier to walk through what the buyer is open to on a call than in an email.
>
> Worth 20 minutes? [Calendly link]

---

### 4. Confirming a Meeting Already Booked

**Lead message:** "I have sent the meeting for next Monday with my other business partner Derrick."
*(Richard Griffin, HSP Valves — Statera Capital)*

**Lead message (alt):** "That works for me. Talk to you on Monday."
*(Ramon, JOINN Biologics — ACT Capital)*

**Response pattern:** 2–3 lines max. Confirm you have it, nothing else.

> Richard,
>
> Confirmed — looking forward to speaking with you and Derrick on Monday.
>
> [Sender name]

**Never:** "That's fantastic news", "Really appreciate it", "Super excited to connect" — all violate tone rules.

---

### Venture Exits — Sell-Side Sourcing Campaign

When replying to a business owner on Venture Exits' Texas sell-side campaign, always frame the conversation as if there is a specific buyer already interested. Do not say "find buyers" or "what kind of buyers would make sense." The pitch is that a buyer has expressed interest in their type of business. Pull to a call to see if the fit is right.

---

### Asking for Financial Metrics Before a Call

When a prospect asks for a ballpark EBITDA or revenue figure, first check if the numbers are in the teaser. If they are, just send the teaser — they will find them there.

If you are unsure what is in the teaser, use this framing:

"Everything I am able to cover pre-NDA is within the teaser here: [teaser link]

Happy to cover everything in more detail on a quick call, including the NDA. Feel free to grab a time here: [Calendly link]"

Do not make up an excuse for not sharing numbers. This framing is honest, pulls them to the teaser, and moves them toward a call and NDA in one move.

---

### 5. Referral to Another Contact / Internal Redirect

**Lead message:** "If you're working on a specific buy-side engagement, please send me the parameters your client is looking for and I can connect you with the right person on our team to discuss."
*(Rich Hull, Miso Robotics — Statera Capital — first email)*

**Lead message (later):** "While we're surely a middle market robotics company... I'm connecting you here with Kevin Patel to have a quick chat."
*(same thread, second email)*

**Response pattern (first email):** Send the brief parameters, stay concise, move toward a call.
**Response pattern (referral):** Thank for intro, contact Kevin Patel directly. Use the referral as your opener: "Rich Hull suggested I reach out."

> Hi Kevin,
>
> Rich Hull suggested I reach out. We're working with a PE firm that recently acquired a platform in the AIDC space and is now looking to add robotics or machine vision capability.
>
> Happy to share the specifics on a quick call. Are you available this week or next?
>
> [Sender name]

---

### 6. "Send More Info Before We Talk" / NDA Request

**Lead message:** "Can I review the CIM before our call so I do not waste your time? See email below where I asked for NDA."
*(Gregory, Mighty Acorns Capital — Venture Exits)*

**Lead message (alt):** "We will fill out the NDA and I look forward to learning more."
*(Daniel Bonoff, Goode Partners — ACT Capital)*

**Response pattern for NDA request:** Agree immediately, say you'll coordinate it right away, restate that a call is still the next step after review.

> Gregory,
>
> Of course. I'll get the NDA across to you now — once you've signed we'll send the CIM. Happy to set up a call after you've had a chance to review.
>
> [Sender name]

**Response pattern for NDA confirmed signed:** Brief acknowledgment, confirm what's coming next.

> Dan,
>
> Great. We'll send across the materials once we have the executed NDA. I'll follow up Monday.
>
> [Sender name]

---

### 7. Meeting Link Broken / Technical Issue

**Lead message:** "there is no link to join — you can call me at 818 585 9183"
*(Chris Vuillaume, CrisisGo — ACT Capital)*

**Response pattern:** Immediate action. Don't apologize extensively — just fix it.

> Chris, calling you now at 818-585-9183. If I miss you, I'll send a fresh link right away.

**Flag:** This is urgent. Do not let it sit. Call or reschedule within minutes.

---

### 8. Lead Gives Specific Meeting Availability

**Lead message:** "How about 9 AM PT on this Tuesday?"
*(Todd, Pastease — GN Motion)*

**Lead message (alt):** "I will be available for a call next week or the week after if this is convenient for you."
*(Mariyan, Renalfa — Statera Capital)*

**Response pattern:** Accept immediately, book it manually, send the calendar invite. Do not ask again for times they've already given you.

> Perfect — 9 AM PT Tuesday is confirmed. I'll send over the calendar invite now.

**Booking rule:** When the lead names a day/time → book it manually in the sender's calendar. Do not send another Calendly link.

---

### 9. "Not in the Right Revenue Range" — Buy-and-Build Angle

**Lead message:** "I'm open to having a conversation, but slightly under that earnings level currently. That said, I have my own acquisition pipeline of other small hockey brands that together could create pretty sizable scale, if your client has an appetite for a buy and build in hockey products."
*(David Shuler, Sniper's Edge Hockey — Hahnbeck)*

**Response pattern:** Acknowledge the buy-and-build angle as genuinely interesting, pull to call. Don't dismiss the size mismatch.

> David,
>
> The buy-and-build angle is exactly the kind of thing worth a call. Our client is open to platform-style opportunities, and 20+ years of M&A experience on your end makes for a very different conversation than a standard seller.
>
> Are you free for 20 minutes next week?

---

### 10. Requesting a Proposal / Company Profile Instead of a Call

**Lead message:** "Please send more information about your company and other things we need to review and we can have a chat next week."
*(Joe, GLO24K — Hahnbeck)*

**Response pattern:** Send materials briefly framed, then confirm the meeting next week rather than leaving it open.

> Joe,
>
> Sending across our overview now. Happy to walk through the details on a call next week — I'll follow up Monday morning to find a time.

---

### 11. Redirected via Assistant / Admin

**Lead message:** Lead replies via their EA or redirects you to an admin to coordinate the meeting.

**Response pattern:** Address the assistant directly, be warm but not over-formal. Include Calendly link for easy scheduling.

> Hi [Assistant name],
>
> Thanks for following up. Happy to work through your calendar — feel free to grab a time here: [Calendly link] or let me know what works and I'll coordinate around it.

---

## Not-Interested / Stop Scenarios

### Unsubscribe — Hard Stop

Trigger words: "remove me", "unsubscribe", "stop", "don't follow up", "take me off your list"

**Response pattern:** 2 lines. Confirm removal. No apology essay.

> Hi [Name],
>
> Removed — you won't hear from us again.

Or for an angrier reply (e.g., "STEP BACK AND DO NOT CONTACT ME EVER AGAIN"):

> [Name], removed immediately. Won't contact you again.

**Flag in system:** Mark `unsubscribe`. Stop all sequences. No exceptions.

---

### Wrong Target / Not a Fit

Lead says they're a nonprofit, wrong sector, wrong investor type (e.g., "we invest in funds, not companies").

**Response pattern:** Brief apology for misdirected outreach, confirm removal.

> Hi Helen,
>
> Apologies for the mismatch — we should have done better research before reaching out. Removing you from our list now and won't follow up.

Do not pad it out or explain your process.

---

### Email Delivery Failure / Bounce

No reply needed. Flag internally to remove that address from the campaign list.

---

### 12. "Not Right Time / Match is Off"

**Lead message:** "Not right time. Match is off as well."
*(Joel, Fairchild Industries — Statera Capital)*

**Lead message (alt):** "We don't miss calls out of hours as we have a system in place."
*(Mark, Alexandra Dental — Sonaro AI)*

**Response pattern:** One line. Acknowledge, keep the door open. Do not push. Do not re-pitch.

> Joel, understood — I'll leave it there. If the timing changes, feel free to reach out.

---

### 13. "Forwarded to Colleague / Marketing"

Two sub-patterns:

**A. CC'd on the reply** ("My colleague Laura, CC'd here, will follow up if interested"):

→ Email Laura directly. Use the original sender as the warm intro opener.

> Hi Laura,
>
> Andreas mentioned you're the right person to speak with at HOUSEWORK regarding product visuals. Happy to send over a sample — worth a quick look?

**B. "I forwarded your email to marketing, they may reach out"** — Do NOT follow up. They've deprioritized it. The ball is in their court.

---

### 14. "Qualifying Questions Before the Call"

**Lead message:** "Before diving deeper, could you give me more detail on — the type of acquisition you typically do — the 'space' you consider we are in — average buying tickets — do you focus on PE M&A or also industrials?"
*(Maxime, Osol — Statera Capital)*

**Response pattern:** Answer each question concisely in prose (not bullets), then close with a call. Don't write an essay — match the register of their questions.

> Hi Max,
>
> Happy to qualify. Our client is a PE firm consolidating in IT services and software — add-ons typically in the €5-25M EBITDA range, not industrial. Given that context, the space question is worth a short call to clarify since sector framing often shifts when we get into specifics.
>
> 15 minutes next week?

---

### 15. "Send Portfolio / Examples First"

**Lead message:** "Could you please share examples of previous visuals you created for jewellery brands? Our designs are quite particular and often do not perform well with CGI."
*(Chiara, FerriFirenze — GN Motion)*

**Response pattern:** Send the portfolio with a single line of framing, then close with a call. Do not over-explain or pre-defend the work.

> Hi Chiara,
>
> Sending over jewelry examples now — metalwork, gemstone rendering, and high-detail pieces are where we do most of our work. Take a look and let me know if it's worth a quick call to discuss your specific designs.

---

### 16. Contact No Longer With the Company

**Lead message:** "I am no longer part of the team at [Company]. For any request, please contact Marion at marion@company.com"
*(Melina, La Cerise sur le Gâteau — GN Motion)*

**Response pattern:** No reply needed to the original contact. Email Marion directly with the original intro context.

---

### 17. "Not Interested" — Soft Decline (No Unsubscribe Request)

**Lead message:** "No thank you — we are well covered for this area."
*(Alastair, Chelsea Surgical — Sonaro AI)*

**Lead message (alt):** "No interest" / "Non merci"

**Response pattern:** One line acknowledgment only. Keep the door cracked but don't push.

> Hi Alastair,
>
> Understood — good to know you're covered. Won't follow up further.

Do NOT: "If anything changes down the road feel free to reach out and best of luck with everything!" — this is padding.

---

---

## Real Response Templates — Pulled from Live EmailBison Data

*These are the actual sent replies used across workspaces. Use as starting points — adjust for lead-specific context before sending.*

---

### ACT Capital / Venture Exits / Statera Capital — M&A Send-Side

**Scenario: Lead says "send me the teaser"**

> Hi [Name],
>
> I appreciate the quick response.
>
> Here's the teaser for the opportunity we discussed: [Teaser link]
>
> Happy to walk you through the details on a quick call. Feel free to grab a time here: [Calendly link] — or let me know what works for you and we'll coordinate.
>
> Best regards,
> [Sender name]
> [Title]
> Direct: [Phone]

**Scenario: Lead gives a specific day ("Monday works for me")**

> Hi [Name],
>
> Sounds great, [Day] works for me.
>
> I've gone ahead and booked a placeholder for us to speak on [Day] at [Time].
>
> Could you please confirm that you received the calendar invitation?
>
> If the time doesn't work, you can easily reschedule using the link included in the invitation.
>
> I'm looking forward to our conversation, and if anything comes up beforehand, feel free to reach out.
>
> Best regards,
> [Sender name]

**Scenario: Lead asks about valuation / what's it worth**

> Hard to give a number without knowing more about the business. Valuation depends on revenue, EBITDA, growth trajectory, and a few other factors that vary deal to deal.
>
> A quick call is really the best way to give you a realistic range. Feel free to grab a time here: [Calendly link]
>
> Best regards,
> [Sender name]

**Scenario: Lead asks for more detail before committing to a call**

> We have been active in [sector]. The details are better discussed on a call — it would also give me a chance to learn more about [Company] and give you a realistic sense of what buyers in this space are paying right now.
>
> Feel free to grab a time here: [Calendly link]
>
> Best regards,
> [Sender name]

**Scenario: Lead says "not in range but there's a merger / investor angle"**

> Appreciate the transparency, that actually helps a lot.
>
> The revenue range puts [Company] outside of what our current buyers are targeting, but the [merger / investor partner] angle is worth a conversation. We work with buyers across different structures and not everything needs to be a clean acquisition.
>
> Let's hop on a quick call and see if there is something worth exploring. Feel free to grab a time here: [Calendly link]

---

### Larsen Digital — Growth/Exit Agency

**Scenario: Lead asks for case study / proof of work**

> Hi [Name],
>
> Sure thing!
>
> Here is the full case study: [link]
>
> I'd be more than happy to map out a similar plan for your brand over a quick call this or next week. You can grab whichever works best for you here: [Calendly link]
>
> Best regards,
> Nicklas Larsen
> Founder, Larsen Digital

**Scenario: Lead says "let me know when we can book a call"**

> Hi [Name],
>
> Sounds great!
>
> I've got a few slots open next week — you can grab whichever works best for you here: [Calendly link]
>
> And if nothing fits, just suggest a couple of times and I'll try to make it work.
>
> Looking forward to it!
>
> Best regards,
> Nicklas Larsen

---

### Acceler8rs — Growth Agency (Lukas Maxen)

**Scenario: Lead asks "what do you do / send me more info"**

> Hi [Name],
>
> Sure thing!
>
> To give you some more details, we run a 3-phase system for consumer brands:
>
> 1. Grow — Find PMF and build a profitable acquisition engine to start generating strong cash flow.
>
> 2. Scale — Operating partner for brands above 7 figures/year (P&L, forecasting, growth execution, KPIs — often with equity).
>
> 3. Exit — When the time is right, we manage the M&A process through our investment banking partners.
>
> [Brief case study line — e.g. "KyiKyi went from £13k to £140k/month in 60 days."]
>
> Worth a quick call to map out a path for [Company]? [Calendly link]
>
> Best regards,
> Lukas Maxen

**Scenario: Lead says "happy to speak / send me a calendar invite"**

> Hi [Name],
>
> Great to hear from you!
>
> I've gone ahead and placed a placeholder on the calendar for [Day] at [Time]. If another time works better, feel free to reschedule using the link in the invite.
>
> Looking forward to speaking soon.
>
> Best regards,
> Lukas Maxen

**Scenario: Lead says "open to a call but not until end of year"**

> Same response as above — book the placeholder anyway for the suggested window. Do not ask when exactly. Lock something in and let them reschedule if needed.

---

### Hahnbeck — Ecom Acquisitions (Taliesen Hollywood)

**Workflow note:** Hahnbeck operates differently — interested replies are forwarded directly to the client (Taliesen / Hahnbeck team) rather than responded to directly from the EmailBison inbox. The EmailBison account is used to receive and route, not to draft outbound replies for this workspace.

When a Hahnbeck lead is interested → forward immediately to the client contact with the lead's message. Client handles the reply from their own inbox.

---

## AI Analysis Quality Note

The AI-suggested replies in the dashboard often violate tone rules. Common issues to fix before sending:

- "That's fantastic news" → delete, just confirm
- "Really appreciate you taking the time" → delete
- "I'd love to hop on a quick call" → "Worth a quick call"
- "I'm so excited to show you what we can do" → never use
- "Looking forward to diving into this with you" → "Looking forward to it"
- Replies to a "yes/confirmed" message that run 4+ lines → cut to 2–3 lines max
- Calendar confirmation replies that re-pitch the value → don't, just confirm the time

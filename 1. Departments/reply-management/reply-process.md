# Reply & Follow-Up Playbook

Read this alongside the relevant client file in `campaign-strategy/` before generating, improving, or classifying any reply or follow-up email.

---

## The Process (Same for All Clients)

1. **Lead replies → interested** — send a reply + Calendly link. Use the client's Calendly link from `client-management/client-profiles.md`.
2. **Lead books a call** — send confirmation. Mark `meeting_booked = TRUE` in DB.
3. **Lead replies → interested but no booking** — start follow-up sequence (FU1 → FU10).
4. **No response after any FU** — wait 7 days, send next FU in sequence.
5. **Lead unsubscribes or says hard no at any point** — stop immediately. Do not follow up.
6. **Lead books after a FU** — stop sequence, send confirmation.

---

## Global Reply Rules

- Always use the lead's first name
- Keep replies to 3–5 sentences max unless the lead asked a specific question
- Never mention competitors
- Never make price or valuation promises unless the client profile says otherwise
- If a lead gives a specific time/date → treat as `interested_urgent`, confirm immediately, send Calendly link
- If a lead asks to be removed → mark `unsubscribe`, stop all follow-ups
- Tone and offer details always come from the client file in `campaign-strategy/`

---

## Objection Handling

| Objection | How to respond |
|---|---|
| "Send me more info / a deck" | Send materials if available, follow up in 7 days if no response |
| "Not the right time" | Acknowledge, ask when to follow up, add to FU sequence |
| "Already working with someone" | Politely acknowledge, keep door open, do not push |
| "What's the valuation / deal structure?" | Answer based on client offer in `campaign-strategy/`, offer a call for details |
| "Remove me" | Stop immediately, mark unsubscribe |
| [Add more common objections here] | |

---

## Follow-Up Sequence — Structure

The sequence runs for up to 10 follow-ups, spaced 7 days apart unless client profile says otherwise.

- **FU1–FU3:** Warm, informative, reference the original interest
- **FU4–FU6:** Shorter, more direct, create mild urgency
- **FU7–FU9:** Very short, low-pressure, keep door open
- **FU10:** Final email — close the loop, leave on good terms

---

## Client Follow-Up Templates

---

### Larsen Digital (`larsen-digital`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### ACT Capital (`act-capital`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### Acceler8rs (`acceler8rs`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### Hahnbeck (`hahnbeck`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### 911 Restoration (`911-restoration`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### Micro Nordic (`micro-nordic`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### GN Motion (`gn-motion`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### Statera Capital (`statera-capital`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### Venture Exits (`venture-exits`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### Wrobel Capital (`wrobel-capital`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### Zenith Global (`zenith-global`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### ITG Group (`itg-group`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### Sonaro AI (`sonaro-ai`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### Zebs IBS (`zebs-ibs`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

### SRO Consulting (`sro-consulting`)

**FU1** Subject: / Body:
**FU2** Subject: / Body:
**FU3** Subject: / Body:
**FU4** Subject: / Body:
**FU5** Subject: / Body:
**FU6** Subject: / Body:
**FU7** Subject: / Body:
**FU8** Subject: / Body:
**FU9** Subject: / Body:
**FU10** Subject: / Body:

---

## Confirmation Email (When Lead Books a Call)

Used across all clients — swap in client name and Calendly details from `client-management/client-profiles.md`.

Subject: Confirmed — [Day, Date] at [Time]

Body:
Hi [First Name],

Perfect — we're confirmed for [Day, Date] at [Time]. You'll receive a calendar invite shortly.

Looking forward to speaking.

[Sender Name]

---

## Stop Rules

- Lead says "remove me", "unsubscribe", "not interested" → stop immediately, no exceptions
- Lead goes silent after FU10 → close the sequence, do not contact again unless they re-engage
- Lead books a call at any point → stop FU sequence immediately
- Lead says "follow up in X months" → pause sequence, resume at the date they specified

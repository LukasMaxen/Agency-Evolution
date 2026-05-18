# Skill: Write Campaign Script

## What this skill does
Writes a cold email sequence (steps 1–3) for any client campaign. Outputs subject lines, body copy, and P.S. lines formatted and ready to paste into EmailBison. Also generates A/B variants and spintax subject lines on request.

---

## Before Writing

Gather or confirm these before drafting:

1. **Who are you writing to?** Role, company type, why them specifically
2. **What do you want?** The outcome (meeting, teaser send, reply, intro)
3. **What is the value?** The specific problem you solve for people like them
4. **What is the proof?** A result, case study, or credibility signal
5. **Any research signals?** Funding, hiring, LinkedIn posts, company news, industry timing

Work with whatever is available. If the client file has a strong hook and clear value prop, that is enough to draft. Note what is missing but do not block on it.

---

## When to run this
- Starting a new campaign from scratch
- Rotating existing scripts to avoid spam flagging
- Generating A/B variants for step 1 body or subject lines
- Writing a single step in isolation (e.g. just a new step 2)
- Scripts are getting caught in spam filters

---

## How to run
Ask Claude:
> "Write a 3-step sequence for 911 Restoration"
> "Generate two A/B variants for ACT Capital step 1"
> "Rotate the GN Motion scripts — they're getting caught in spam"
> "Write a step 2 for Larsen Digital"
> "Give me 5 subject line spintax variations for the Hahnbeck campaign"
> "Rewrite the ITG sequence with a different visual structure"

---

## What Claude will do

1. Read `clients/[client-slug].md` for the client's offer, ICP, hooks, CTAs, what works, and what doesn't
2. Read `1. Departments/campaign/CONTEXT_Campaign.md` for global formatting and sequence rules
3. Draft each step following the Step 1 / Step 2 / Step 3 structure
4. Apply the correct CTA format for the client (phone call for 911, teaser for M&A, qualifying question for ITG, etc.)
5. Apply the correct P.S. rule for the client type
6. Check for spam trigger words and flag any before outputting
7. If A/B variants are requested: ensure at least 65–70% structural difference between variants

---

## Output format

**Step 1**
Subject: [subject line or spintax block]
Body:
[email body — prose, no bullets, no em dashes]
P.S. [opt-out line if applicable for this client type]

**Step 2**
Subject: [subject line]
Body:
[one-question follow-up — no pitch, no CTA beyond the question]

**Step 3**
Subject: [subject line]
Body:
[re-engagement — informative, no "last note" language]
P.S. [opt-out line if applicable]

---

## Rules Claude must follow
- Read `clients/[slug].md` before writing — never draft from memory alone
- No em dashes, no bullet points in scripts
- No "last note from me" or any end-of-sequence language
- For 911 Restoration: always say "phone call", never just "call" or "quick chat"
- For Acceler8rs / Larsen Digital: always say "your brand", never {COMPANY}
- For ITG: always open "Dear Sir", never {FIRST_NAME}
- Spintax subject lines: at least 5 variations, no shared first word across variants
- Flag any spam trigger words found in the draft before outputting

---

## Quality Check (before presenting any draft)

- Does it sound like a human wrote it? Read it aloud.
- Would you reply to this if you received it?
- Does every sentence serve the reader, not the sender?
- Is the personalization connected to the problem, or is it decorative?
- Is there one clear, low-friction ask?

If any answer is no, fix it before outputting.

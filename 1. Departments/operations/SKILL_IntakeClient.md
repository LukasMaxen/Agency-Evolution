# Skill: Client Intake Interview

## What this skill does
Conducts a structured interview to gather all the information needed to fully populate a new client file. Runs as a conversation — Claude asks one section at a time, waits for answers, then writes the completed client file at the end. Also used to fill in gaps in an existing client file.

---

## When to run this
- A new client has just been signed and needs a client file created
- An existing client file has blank or placeholder sections that need filling in
- A client has added a new campaign and the file needs a new campaign block
- After a kickoff call — use your notes to answer the interview questions

---

## How to run
Say to Claude:
> "Run the client intake for [CLIENT NAME]"
> "Intake interview for a new client — slug will be [slug]"
> "Fill in the gaps in [client-slug].md — run the intake"
> "New campaign for [client] — add it to their file"

---

## What Claude will do

Claude runs the interview in sections. It asks all questions in one section before moving to the next. It does not ask for information already present in the file (if updating an existing file).

After all sections are complete, Claude writes the fully populated client file (or campaign block) and confirms before saving.

---

### Section 1 — Quick Reference

Ask:
1. What is the client's full name and what slug should we use? (e.g. `911-restoration`)
2. What is the status? (Active / Paused / Churned)
3. What is the signed date?
4. What is the monthly retainer?
5. What is the name of their Slack channel?
6. How many campaigns are we running for them right now? Give each one a short name.

---

### Section 2 — Contacts

For each contact at this client, ask:
1. Name and role at the company?
2. Email address?
3. Calendly link? (If they have more than one, which campaign does each belong to?)
4. Timezone?
5. Any notes on this contact — are they the primary, do they need to be CC'd, any communication preferences?

_Repeat until all contacts are captured._

---

### Section 3 — Client Overview

Ask:
1. What does this company do? (One paragraph — what they sell, who they serve, how long they've been operating, notable credentials.)
2. What makes them different from alternatives? What proof points or credentials can we always reference across any campaign?
3. What can they never say or promise — hard constraints that apply across all campaigns?

---

### Section 4 — Campaign Interview (repeat for each campaign)

Say: _"Now let's go through each campaign one at a time. Starting with [Campaign Name]."_

**Offer:**
1. What exactly is this campaign selling or recruiting for? Be specific.
2. What is the single strongest reason a prospect should care — the core hook?
3. What key stats or proof points should always be included? (List them.)
4. Any constraints specific to this campaign — things we can never say or promise in this context?

**Target Audience (ICP):**
5. What industry or business type are we targeting?
6. What job titles are we targeting?
7. What geography?
8. What company size or revenue range?
9. Any other qualification criteria?
10. What makes someone a clear fit — what does a good lead look like?
11. What disqualifies a lead for this campaign?

**Script Rules:**
12. What is the Step 1 CTA — the exact ask at the end of the first email?
13. What is the Step 2 CTA?
14. What is the Step 3 CTA?
15. What merge variables do we use? ({FIRST_NAME}, {COMPANY}, {CITY}, {STATE}, etc.)
16. What are the strongest hooks, ranked? (Ask for at least 3.)
17. What has worked — angles, lines, or framings that get replies?
18. What has NOT worked — angles or framings to never repeat?
19. Any formatting or spam rules specific to this campaign? (Symbols to avoid, words to never use, etc.)
20. Does this campaign use a P.S. line? If so, what is it?

**Reply Guidelines:**
21. What tone should replies have for this campaign?
22. What does an interested reply look like — specific words or phrases that signal real intent?
23. What does a not-interested reply look like?
24. What are the most common objections and how should we handle each one?
25. Are there things we should never say in replies for this campaign?

**Lead Sourcing:**
26. What data sources work best for this campaign? (Apollo, LinkedIn Sales Nav, directories, etc.)
27. What filters, industries, titles, or Boolean strings work well?
28. What types of lists or leads should we avoid?

**Lead Enrichment:**
29. What enrichment fields matter most for personalisation in this campaign?
30. How do we personalise outreach — by city, revenue, company type, recent news?

_After all campaign questions are answered, say: "Got it. Moving on to the next campaign." Repeat Section 4 for each additional campaign._

---

### Section 5 — Existing Campaign Performance (if updating an existing file)

For each campaign:
1. Do you have any performance data to log? (Leads sent, open rate, reply rate, interested rate?)
2. Any notes on what changed or what you learned from this campaign so far?

---

### Section 6 — Key Conversations

Ask:
1. Are there any Slack messages, emails, or meeting notes from this client you want to log right now? (Paste them in and I'll format and add them.)
2. Anything that happened in the kickoff call or onboarding that isn't captured yet?

---

### Section 7 — Internal Notes

Ask:
1. Anything else about this client — quirks, sensitivities, relationship context, things to never bring up, or anything that helps when working on this account?

---

## Output format

After the interview is complete:

1. Claude shows a summary of all answers in a structured preview
2. Flags any sections that are still blank or need follow-up
3. Asks: *"Ready to write the client file? Any corrections before I do?"*
4. On confirmation, writes the full client file to `clients/[slug].md` using `clients/_template.md` as the structure
5. For additional campaigns: writes a new campaign block into the existing file
6. Reports what was written and what is still blank

---

## Rules Claude must follow

- Ask one section at a time — do not dump all questions at once
- Never skip a section, even if it feels redundant — every section has a purpose
- If the client already has a file, read it first and skip questions that are already answered
- If a campaign name is not provided, ask for one before starting that campaign's section
- Never write the file until Section 7 is complete and the user confirms
- If an answer is vague (e.g. "standard CTA"), push back and ask for the exact wording — vague answers produce vague client files
- Flag any missing critical fields after writing: Calendly link, Step 1/2/3 CTAs, and ICP are the most important — never leave these blank without flagging
- Do not invent or assume details — if you don't know it, mark it as `[fill in]` and flag it at the end

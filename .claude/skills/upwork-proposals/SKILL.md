---
name: upwork-proposals
description: Daily Upwork proposal run in Kasper's logged-in Chrome. "upwork scan" finds and filters new jobs, drafts proposals, posts approval cards to #upwork-approval. "upwork submit" submits only cards Kasper marked 📤 (✅ means he already sent it manually, never submit those). Invoke when the user says "upwork scan", "upwork submit", "run upwork", or similar.
---

# Upwork Proposals

Two commands, both triggered manually by Kasper.

**Browser fallback:** if Claude in Chrome tools are missing, use the Chrome DevTools MCP browser (`new_page`/`navigate_page`/`evaluate_script` with inline `function`, scripts from the scratchpad are not allowed). It is a separate Chrome profile: if it shows the Upwork login page, Kasper logs in himself, never type credentials. Same snippets work; pass them as `async () => {...}`. Uses Claude in Chrome on his logged-in Upwork account (Kasper Z, Cold Email & Outbound profile).

**Credit rules (hard):**
- Never take screenshots unless a step is stuck. Read pages only with the `javascript_tool` snippets below.
- Do not read client files, memory files or other docs for this skill. Everything needed is in this file.
- No logging beyond the seen list the script keeps. No reports, no summaries beyond a few lines at the end.
- Batch browser calls with `browser_batch` wherever possible. Close the tab when done.
- Current budget (set 2026-10-15): **825 Connects over 5 working days = 165 Connects per day, about 6 boosted proposals a day.** Scan posts max **8 cards** so Kasper can pick the best ~6. Submit stops once **today** has spent 165 Connects (tracked by the script across runs). Skip any job costing more than 25 Connects to apply.

## METHOD UPDATE 2026-10-28 (Kasper). Overrides every older rule below where they conflict.

**Who to apply to:** any job where the client wants someone to run their email sending for them: cold email, outbound email, email outreach, email deliverability, sending infrastructure, high-volume email operations. If they want someone to do email for them, that is exactly what we do. Client rating, hire rate, spend, country, budget, industry and the old ICP score do NOT matter anymore. Only skip: jobs we already applied to, closed jobs, pure cold calling / SMS / DM-only jobs, pure list-building or data entry, and full sales-closer roles. Reference example: job ~022113250923376148718 (high-volume email + deliverability for an events business).

**Pricing:** never mention pricing, rates, fees or how we charge. If a screening question asks about pay, rate or structure, answer along the lines of: "We're flexible on how we set it up, so I'd rather find what works for you on a quick video call."

**CTA:** always a video call. End with a direct question like "Would you be up for a quick video call this week?"

**Tone:** human and a notch informal, down to earth, plain words anyone can follow. Still professional and clearly competent, especially when explaining the email side (deliverability, domains, warm-up, lists, replies). Short sentences, no corporate phrasing, no hype.

**Tools:** when relevant or asked, say what we actually use: Apollo for data, EmailBison for sending, and our own internally developed verification software (plus our own enrichment builds). Never claim expertise in tools we don't use (GoHighLevel, HubSpot, Clay, etc.).

**No 30-hour claim (Kasper, 2026-10-28):** never mention "first lead within 30 hours" (or any first-lead timing) in proposals or answers. Older templates and examples that contain it are outdated; drop that sentence.

**Only true statements (Kasper, 2026-10-28):** never write anything that isn't true for us. We do NOT use GoHighLevel (or HubSpot, Clay, Instantly, Smartlead, Mailgun etc.); if the job relies on one, be upfront that we run sending on our own setup. Don't promise reporting formats, consent tracking or processes that aren't in the facts list. When unsure, leave it out.

**Facts added 2026-10-28 (Kasper):** we've been doing this for 5+ years. We do the email setup ourselves end to end and bring our own software into it, so the client never has to teach or manage us. Convey that confidence ("we handle the setup ourselves", "more than five years"), never say it rudely or imply they'd have to explain things. Don't write that we'll set things up "together with your team" or that a platform "isn't our main platform".

**How we work, say it clearly (Kasper, 2026-10-28):** we do everything ourselves with our own software, from setup to sending to replies. Volume is never the limit on our side, we can push as much as they want, it only comes down to how big their market is (say "market", not "TAM"). We build toward whatever outcome they want: event or summit registrations, sales calls, sign ups. When it's calls, we set them up so all they do is show up, and every call is with an interested lead. Aim to impress with competence, stay friendly, and write as Kasper in the first person, like a good person talking to another business owner.

**Connects per application (2026-10-28):** max 85 Connects per application INCLUDING boost. Boost only exactly enough to reach 4th place (4th place bid + 1). If proposal cost + that boost would go over 85, don't boost. Never boost above 4th place.

**Never mirror their post back (Kasper, 2026-10-28):** no "I saw you want...", "You need someone who...", "You're looking for...". The [personal line] in the old templates is dropped.

**Natural phrasing only (Kasper, 2026-10-28):** never write lines real people don't say, e.g. "I read through your post properly", "I read your post carefully", "To answer your questions directly", "Every address should earn its place", "I hope this finds you well". No meta comments about the proposal itself. Show you read the post by talking about their specifics, not by saying so.

**Writing rules (2026-10-28):** no em dashes, no en dashes, no normal hyphens/dashes, and no colons anywhere in the message body or answers (write "high volume", "follow up", "opt out", rephrase lists into sentences). Read the WHOLE post (expand "more") and make sure every concern or responsibility they list is answered somewhere, in plain words. Explain how we work.



Helper script: `node .claude/skills/upwork-proposals/upwork.cjs <cmd>`. **Always single-quote job ids** (`'~0221...'`), zsh expands a bare `~` (Slack channel C0C9JHB59FU, seen list in `~/.upwork-proposals/seen.txt`).

Javascript output rule: never return URLs or `key=value` strings from page scripts (the extension blocks the whole result). Every snippet below strips `= ? &` from text it returns via `c()`. If a result still comes back BLOCKED, rerun with shorter slices, never fall back to screenshots.

---

## upwork scan

### 1. Search (one page per query, Upwork does the first filtering)

**Login check first (always):** on the first search page run `({out:/Log in/.test(document.querySelector('header')?.innerText||''), n:document.querySelectorAll('article').length})`. If `out` is true, or `n` is 0 on a query that normally has results, STOP: tell Kasper Upwork is logged out in Chrome and to log in himself, then rerun. Never type credentials. An empty result list is only trusted when `n` > 0.

Base URL, swap in each query:
`https://www.upwork.com/nx/search/jobs/?q=QUERY&sort=recency&per_page=50`

Queries (14): `cold%20email`, `email%20deliverability`, `email%20outreach`, `cold%20email%20specialist`, `lead%20generation`, `appointment%20setting`, `outbound%20sales`, `b2b%20lead%20generation`, `book%20meetings`, `sales%20meetings`, `outbound%20agency`, `cold%20outreach`, `linkedin%20outreach`, `sdr`. Run them all in ONE `browser_batch` (navigate + snippet per query).

**Cheap mode:** on the FIRST page, wrap the snippet below in an async IIFE string, save it with `localStorage.setItem('upwScan', SRC)` and run `await eval(SRC)`; on every later page just run `await eval(localStorage.getItem('upwScan'))`. Add a `SEEN` id list inside the snippet (from `~/.upwork-proposals/seen.txt`, ids without `~`) so seen jobs never come back. An empty `[]` is normal when nothing new passed.

On each page run this (it waits for load, applies the hard filters, returns compact rows):

```js
await new Promise(r=>setTimeout(r,3000));
const BAD=/India|Pakistan|Bangladesh|Nigeria|Philippines|Egypt|Kenya|Vietnam|Indonesia|Sri Lanka|Nepal|Ghana|Morocco|Algeria|Ethiopia/;
const num=s=>{const m=(s||'').match(/\$([\d,.]+)\s*([KM])?/);if(!m)return null;return parseFloat(m[1].replace(/,/g,''))*(m[2]==='M'?1e6:m[2]==='K'?1e3:1);};
const c=s=>(s||'').replace(/[=?&]/g,' ');
[...document.querySelectorAll('article')].map(a=>{
 const q=s=>a.querySelector(`[data-test~="${s}"]`)?.innerText.trim().replace(/\s+/g,' ')||'';
 const info=q('JobInfo'), spent=num(q('total-spent'))||0, loc=q('location').replace('Location ','');
 const fixed=/Fixed/.test(info), hi=[...info.matchAll(/\$([\d,.]+)/g)].map(m=>+m[1].replace(/,/g,'')), top=hi.length?Math.max(...hi):null;
 const id=((a.querySelector('a[href*="/jobs/"]')?.getAttribute('href')||'').match(/~\w+/)||[''])[0];
 const drop=''; // 2026-10-28: no spend/country/budget filters anymore
 return drop?null:{id,t:c(q('job-tile-title-link')),info,spent,loc,posted:q('job-pubilshed-date').split('·')[0].trim(),p:q('proposals-tier').replace('Proposals: ',''),d:c(q('JobDescription').slice(0,220))};
}).filter(Boolean)
```

Merge rows from all queries, dedupe by id, then drop already-evaluated jobs:
`node .claude/skills/upwork-proposals/upwork.cjs unseen <all ids>` (read only).

Only jobs you actually judge get marked: at the end of the scan run `upwork.cjs mark <ids>` for every job dropped in step 2 or later, or carded. Jobs cut only by the top-10 / 8-card caps stay unmarked so tomorrow's scan can still pick them up.

### 2. Fit check from the rows alone (no page loads yet)

Keep only jobs where the client plausibly wants **someone to run outbound and book sales meetings for a B2B business** and can afford a premium done-for-you service. Use judgment; the pricing (internal only) is a sizeable setup fee plus a per-meeting fee, so the client must be a real business with real deal values.

Drop: full-time employee hires at low rates, pure copywriting gigs, "set up my Instantly/Smartlead" tech-only gigs, list scraping or data entry, B2C, cold calling only, agencies looking for cheap white-label subcontractors, MLM/crypto/coaching-funnel style offers, anything vague or tiny.

Rank survivors by fit, then client spend. Take the top 10 into step 3.

### 3. Job detail (one page load each)

Open `https://www.upwork.com/jobs/<id>` and run:

```js
await new Promise(r=>setTimeout(r,2500));
const g=s=>document.querySelector(s)?.innerText.trim().replace(/\s+/g,' ')||'';
const h=[...document.querySelectorAll('h2,h3,h4,h5')].find(e=>/recent history/i.test(e.innerText));
let s=h;for(let i=0;i<4&&s;i++)s=s.parentElement;
const body=document.body.innerText, c=x=>(x||'').replace(/[=?&]/g,' ');
({hire:g('[data-qa="client-job-posting-stats"]'),
 client:c(g('[data-test="about-client-container"]').slice(0,400)),
 company:c(g('[data-qa="client-company-profile"]').slice(0,200)),
 desc:c(g('[data-test="Description"]').slice(0,1800)),
 history:c((s?.innerText||'').replace(/\s+/g,' ').slice(0,1200)),
 connects:(body.match(/Send a proposal for: (\d+) Connects|Required Connects to submit a proposal: (\d+)/)||[]).slice(1).find(Boolean),
 questions:c((body.match(/answer the following questions[^\n]*\n([\s\S]{0,800}?)(?:\n\s*\n[A-Z]|$)/i)||[])[1]||'')})
```

Drop if: hire rate under 50%, `connects` over 25, the full description shows a poor fit or a budget too small to afford us. The question extraction is best effort; the apply page in submit is the source of truth for screening questions.

### 3b. Website check (only for jobs still in after 3)

Find the company website: a domain or company name in `desc` or `client` (company profile). If a domain is found, open it and run ONE read:
```js
await new Promise(r=>setTimeout(r,2000));
const c=x=>(x||'').replace(/[=?&]/g,' ');
({title:c(document.title), meta:c(document.querySelector('meta[name="description"]')?.content), text:c(document.body.innerText.replace(/\s+/g,' ').slice(0,1500))})
```
No domain findable → do not guess or search. Mark website "not verified". Only use the website to SCORE; never quote or reference it in the draft unless the same fact is in their post.

### 3c. ICP score (Kasper's 5 criteria, score each 1 to 5)

1. **Lead acquisition intent:** they want new B2B customers/meetings/pipeline from outbound, not a tool setup, copy-only, list-only or a staff hire.
2. **Big TAM:** thousands of reachable B2B buyers (e.g. SaaS selling to SMBs, agencies, M&A, IT/ops services). Niche local or tiny markets score low.
3. **Can pay:** passing the $10K+ spend filter is enough evidence (Kasper's rule). Do NOT penalize low average hourly rate paid, low pilot budgets or early stage. Score 4 by default; 5 for $100K+ spend; below 4 only if the post itself says there is no budget (commission-only, unpaid, equity-only).
4. **Strong website:** professional, clear, credible (real product, clients, proof). "Not verified" = 3 at most, and the card must say so.
5. **GREAT offer:** clear, specific, high-value outcome for a defined buyer, with proof or a reason to buy now. Vague "we do marketing" or commodity offers score low.

**Gates:** drop if criterion 1 or 3 is below 4, or ANY criterion is 2 or lower, or the total is under 18/25. Rank by total. Put the scores in the card's `why` line, e.g. `Intent 5 · TAM 4 · Pay 5 · Site 4 · Offer 4 = 22`, plus one short reason.

**Client first name:** look in `history` for freelancer reviews that name the client ("working with Chris", "Thanks Sarah"). Only use a name if exactly one name clearly refers to the client. Several names or any doubt → no name.

### 4. Draft (max 8)

**Standard structure (Kasper, 2026-10-21). Every proposal follows this, the short templates further down are only for wording ideas:**
1. Intro: `Hi <Name>, I'm Kasper. I run Agency Evolution, we book sales calls for B2B companies. In plain terms, we find the right people, reach out to them, and put the ones who are interested on your calendar.`
2. (Changed 2026-10-28) NO line restating what they're looking for. They wrote the post, they know. Go straight from the intro into how we'd do it, using their specifics (their tools, audience, problems) inside the steps.
3. Channels: ALWAYS pitch email + LinkedIn together, even if they only ask for one. If they ask for LinkedIn: LinkedIn works but is heavily capped (each profile can only reach a limited number of people per week), so email runs alongside it for volume; people who see you on both reply more; "LinkedIn gives you the personal touch, and email gives you the volume." If they ask for email only: same logic in reverse (email for volume, LinkedIn adds the personal touch). Never state an exact weekly LinkedIn limit.
4. `Here's how it would work.` then short paragraphs, one step each: (a) we build and verify the target list around their exact criteria; (b) we write the messaging from their offer (what it does, what that gives the customer, who has that pain) and test angles until one clearly works; (c) LinkedIn runs from their own profiles, email runs from domains and inboxes we set up and warm up, we handle SPF, DKIM, DMARC and deliverability monitoring, everything we set up is theirs to keep; (d) we handle every reply on both channels and book the meetings (they can take over LinkedIn conversations only if they prefer), only people who said yes reach their calendar, campaigns go out day one.
5. Tie it to their post where it fits (e.g. "which is what keeps lead quality going up").
6. Proof line (exact): the 18 calls in under 20 days sentence + portfolio.
7. One direct question about a quick video call, then the signature.
Gold example: the EU payments card (job ~022112546601095497165) as approved by Kasper on 2026-10-21.

**Keep learning:** whenever Kasper states a new fact or correction in chat, add it to the facts list / rules in this file right away (and to memory), then use it in every later draft.

Rules for every draft:
- Opener: `Hi <FirstName>, I'm Kasper.` ONLY when the name is certain (one name, clearly the client). Any doubt (several names, unclear who) → `Hi, I'm Kasper.`
- **Nothing unverifiable.** Every statement about the client must be stated in their post or profile. No guesses about their company, market or situation. Never call us a "small team".
- Replace `[personal line]` with ONE short sentence about something specific in their post (their market, their goal, a detail they mentioned). It must prove we read the post. Never invent facts about Kasper.
- Keep the template structure: who we are, approach, social proof, call question. Short sentences, everyday words.
- Say "call", never "Upwork call". No links, no email addresses, no phone numbers.
- **Upwork-safe: say NOTHING about how we charge.** No prices, fees, setup fee, refunds, retainers, "pay per lead/meeting/show", "no hourly", "not for hours worked", invoicing, or anything hinting at billing, contracts or contact outside Upwork. Results claims are fine ("we measure ourselves on qualified calls that show up"). Pricing only ever comes up on the call.
- No em dashes or en dashes.
- Always end with this exact signature (3 lines): `Best,` / `Kasper Zacho` / `Co-Owner | Agency Evolution`.
- Only these facts may be claimed: Agency Evolution books sales calls for B2B companies through cold email and LinkedIn; we handle the list, writing, sending and replies; we measure ourselves on qualified calls that show up, not emails sent; campaigns go live day one;  our most recent client had 18 calls booked in under 20 days, all interested leads fitting their exact ICP (case study in portfolio); we take on max 20 clients at a time; we handle the targeting and positioning, building and verifying the target list, the technical side (domain warm-up, multiple mailboxes, SPF/DKIM/DMARC, deliverability monitoring) and A/B testing; we work with M&A firms, B2B SaaS, e-commerce brands and professional service firms. LinkedIn is heavily capped per profile per week (no exact number), email is not capped the same way and gives the volume. We handle every reply on both channels and set up the meetings; the client only takes over LinkedIn conversations if they prefer.
- If the job asks for a keyword or code word at the start, put just that word on the first line and move on. No clever line built on it.
- Never claim tool expertise (Apify, Clay, HubSpot, etc.) or experience we can't back up. Apollo and EmailBison may be named only if a screening question asks what we use.
- **No repetition across cover letter and screening answers (Kasper, 2026-10-21).** Each piece gets its own content. When a job has screening questions: the cover letter keeps intro, post line, channels and how it works, and DROPS the proof line; proof (18 calls case study) goes in the experience/results answer; planning facts (plan from what works for them, volume planned backwards, about 1,000 emails per booked meeting as a planning figure, existing database or old leads) go in a results/approach answer. Never restate the same fact or step twice.
- NEVER use the SaaS stat (110 meetings in under 60 days) anywhere (Kasper, 2026-10-21). If a job asks for SaaS-specific results, do not claim any: say client work is kept private, point to the portfolio case study as what it is, and explain how we'd run it for their product.
- Screening questions about past results or similar projects: use the anonymized stats from the reply guide, one per answer, never name the client or describe their product, always add that results depend on market and offer: B2B services client 4x return on cash collected in the first 30 days; M&A client 95% meeting qualification rate; rated 5.0 on Trustpilot; plus the 18 calls case study (in portfolio). Describe our process with the standard steps (verified list, messaging from their offer, email + LinkedIn, every reply handled, meetings booked).
- Screening questions: answer each in 1 to 3 sentences using only the facts above. If a question needs a fact we don't have, or asks about price, rates or budget, answer `[KASPER TO ANSWER]` (Kasper decides whether to be upfront; the approved Upwork pricing wording is in `1. Departments/reply-management/GUIDE_AgencyEvolutionCampaignReplies.md` section 11).
- Full reply rules for when a client answers a proposal: same guide, sections 3 to 9 (but on Upwork: no Calendly link, no email, phone or website, CTA is just "a call").

Templates:

**T1**
Hi, I'm Kasper. I run Agency Evolution. We book sales calls for B2B companies. In plain terms, we find the right people for you, reach out by email and LinkedIn, and put the ones who are interested on your calendar. [personal line]

Your post sounds like exactly that kind of work. We take care of the list, the writing, the sending and the replies, so all you do is show up to the calls.

Our most recent client had 18 calls booked on their calendar in under 20 days, all interested leads who fit their exact ICP. The full case study is in my portfolio.

Would you be up for a quick video call this week?

Best,
Kasper Zacho
Co-Owner | Agency Evolution

**T2**
Hi, I'm Kasper. I run outbound for B2B companies, which basically means I fill their calendars with sales calls so they don't have to chase leads themselves. [personal line]

We focus on results, not activity. What we measure ourselves on is qualified calls that actually show up on your calendar, not emails sent.

Campaigns go live on day one. There's a case study in my portfolio if you want to see real numbers.

Happy to walk you through how it would work for you. Got time for a quick video call this week?

Best,
Kasper Zacho
Co-Owner | Agency Evolution

**T3**
Hi, I'm Kasper. I run an outbound agency called Agency Evolution. We don't sell lists. We do the outreach ourselves and only put people who've said yes on your calendar. [personal line]

I mention that because a lot of people who post jobs like this have been burned before, paying for "leads" that never turned into a single call. With us, the only thing that counts is qualified leads who actually show up on your calendar.

Our most recent client had 18 calls booked on their calendar in under 20 days, all interested leads who fit their exact ICP. The full case study is in my portfolio.

We only take on 20 clients at a time, so I'd like to hear about your business first. Would you be up for a quick video call?

Best,
Kasper Zacho
Co-Owner | Agency Evolution

**T4**
Hi, I'm Kasper. I help B2B companies get more sales calls, and my team handles all the outreach behind it. [personal line]

We build the list, write the emails and LinkedIn messages, send them, deal with the replies and book the interested ones onto your calendar. We measure ourselves on one thing: qualified calls that show up.

It tends to move fast. Our most recent client had 18 calls booked on their calendar in under 20 days, all interested leads who fit their exact ICP. The full case study is in my portfolio.

If that sounds like what you're after, I'd be glad to jump on a quick video call.

Best,
Kasper Zacho
Co-Owner | Agency Evolution

**T5**
Hi, I'm Kasper. I run Agency Evolution, where we book sales calls for B2B companies through cold email and LinkedIn. [personal line]

Before telling you whether we can help, I'd want to know two things: who's your ideal client, and how many new ones could you take on each month?

I ask because we only work with 20 clients at a time and prefer to stay with them long term, so a quick fit check saves us both time. Our most recent client had 18 calls booked on their calendar in under 20 days, all interested leads who fit their exact ICP. The full case study is in my portfolio.

Are you free for a quick video call this week?

Best,
Kasper Zacho
Co-Owner | Agency Evolution

### 5. Post

Write the cards to the scratchpad as `cards.json`:
`[{"id":"~0221...","title":"...","type":"Hourly $40-$80 | Expert","budget":"","client":"$816K spent, 68% hire, US","proposals":"Fewer than 5","connects":17,"why":"one line on fit","draft":"...","answers":[{"q":"...","a":"..."}]}]`

Then `node .claude/skills/upwork-proposals/upwork.cjs post <path>/cards.json`, then `upwork.cjs mark <every evaluated id>` (see step 1), close the tab, and reply in 3 lines max: cards posted, jobs filtered out, connects balance if seen.

---

## upwork submit

1. `upwork.cjs spent` gives Connects already spent today; if 165 or more, say so and stop. Then `upwork.cjs approved` lists cards marked 📤 (outbox_tray) that are not yet 🚀/❌/✅, oldest first. ✅ = Kasper sent it manually himself: never submit, never count as pending. `text` already includes a full-text edit from the thread. If `notes` is non-empty, apply those short instructions from Kasper to `text` yourself (keep every draft rule: no prices, nothing unverifiable, no dashes, no links). `answers` already include his `A1:` overrides. None approved → say so and stop.
2. For each card, open `https://www.upwork.com/nx/proposals/job/<id>/apply/` and run one read:

```js
await new Promise(r=>setTimeout(r,3000));
const b=document.body.innerText;
({ok:!!document.querySelector('textarea[aria-labelledby="cover_letter_label"]'),
 closed:/no longer available|job is closed|already submitted|You have already applied/i.test(b),
 boost:(b.match(/Rank Bid[\s\S]{0,260}/)||[''])[0].replace(/\s+/g,' '),
 balance:(b.match(/Remaining balance: (\d+)/)||[])[1],
 send:(b.match(/Send for (\d+) Connects/)||[])[1],
 questions:[...document.querySelectorAll('textarea:not([aria-labelledby="cover_letter_label"])')].map(t=>(document.getElementById(t.getAttribute('aria-labelledby'))?.innerText||t.closest('div')?.parentElement?.innerText||'').replace(/[=?&]/g,' ').trim().slice(0,160)),
 selects:[...document.querySelectorAll('select,[role="combobox"]')].length,
 fixed:/How do you want to be paid|milestone/i.test(b)})
```

   If `closed` or no cover letter box → `upwork.cjs fail <ts> "<reason>"` and continue.

3. Fill the form:
   - Cover letter (React-safe):
     ```js
     const t=document.querySelector('textarea[aria-labelledby="cover_letter_label"]');
     Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t, TEXT);
     t.dispatchEvent(new Event('input',{bubbles:true}));t.dispatchEvent(new Event('change',{bubbles:true}));t.value.length
     ```
     Pass TEXT as a JSON string literal of the approved text. The returned length must equal the text length, otherwise `fail` the card.
   - Screening questions: match each label in `questions` to the card's answers by meaning, not just order. Fill each textarea the same React-safe way. If a question has no approved answer, or any answer is still `[KASPER TO ANSWER]` → `fail` with "needs Kasper's answer to: <question>" and skip this job (Kasper replies `A1: ...` in the thread; any human reply after the failure note makes the next submit retry it).
   - Rate/bid field: leave whatever Upwork prefilled. Never type a price.
   - Fixed-price jobs: choose "By project" and leave Upwork's prefilled amount ("By milestone" forces typing milestone prices; milestones get set when the contract is agreed); if a duration select is required pick "1 to 3 months". Use `find` + click for these, no screenshots.
   - **Boost every submitted proposal** (Kasper approved each one). Target 4th place. If the boost text shows a bid for 4th place, set bid = that + 1. If fewer than 4 bids exist, bid the minimum Upwork shows. Skip boosting if the bid would be over 10 Connects. Click "Set bid" after typing.
   - Daily cap: if `spent` today + send + boost would go over 165, stop the run and leave the rest approved for tomorrow (first try without boost if that alone fits). Check `send` + boost ≤ `balance`. If not → `fail` with "not enough connects" and stop the whole run.
4. Click the "Send for N Connects" button (`find` it, then click). Then verify with one JS read that the page shows a confirmation or navigated away from `/apply/`. If a captcha, login or unexpected dialog appears, take ONE screenshot, `fail` the card with what you saw, and stop the run so Kasper can handle it.
5. On success: `upwork.cjs done <ts> <send + boost connects>` (records today's spend).
6. Close the tab and reply in 2 lines max: submitted N, failed N (with reasons), connects left.

**Signature exception:** the signature stays exactly "Co-Owner | Agency Evolution" with the hyphen (confirmed by Kasper 2026-10-28). The no-dash rule applies to the body only.

**Paragraph spacing (Kasper, 2026-10-28):** every proposal and answer must have a blank line between paragraphs, and between the last paragraph and the signature (signature lines themselves stay together). After filling the cover letter, read the textarea value back and confirm it contains "\n\n" between paragraphs and that the paragraph count matches the approved draft. If the line breaks got stripped, refill before sending.

**Form facts learned 2026-10-21 (DevTools browser):**
- Screening questions often appear ONLY on the apply page, not the job page. Always read the apply page first, then split content per the no-repeat rule.
- Fill every field with the DevTools `fill` tool by uid (from `take_snapshot`). Setting textarea values by JS does not register with Upwork's validation ("Value is required").
- Hourly jobs show "Schedule a rate increase": open the combobox labelled by `up-sri-form-cadenceMonths-dropdown` and pick **Never** (JS mouse events on the combobox, then the "Never" option, work).
- Fixed price: accept whatever amount Upwork prefills. Hourly: leave the prefilled profile rate. Never type a price.
- Boost: the bid field defaults to the 1st-place amount; ignore it unless you click "Set bid". When ranks 2 to 4 are empty, Upwork may only enable "Set bid" at the 1st-place threshold. Kasper may set a total boost budget per batch (e.g. "max 34 overall"); spend it where it buys a top-4 rank.

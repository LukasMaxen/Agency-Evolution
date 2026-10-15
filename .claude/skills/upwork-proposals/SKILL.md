---
name: upwork-proposals
description: Daily Upwork proposal run in Kasper's logged-in Chrome. "upwork scan" finds and filters new jobs, drafts proposals, posts approval cards to #upwork-approval. "upwork submit" submits the cards Kasper approved with ✅. Invoke when the user says "upwork scan", "upwork submit", "run upwork", or similar.
---

# Upwork Proposals

Two commands, both triggered manually by Kasper. Uses Claude in Chrome on his logged-in Upwork account (Kasper Z, Cold Email & Outbound profile).

**Credit rules (hard):**
- Never take screenshots unless a step is stuck. Read pages only with the `javascript_tool` snippets below.
- Do not read client files, memory files or other docs for this skill. Everything needed is in this file.
- No logging beyond the seen list the script keeps. No reports, no summaries beyond a few lines at the end.
- Batch browser calls with `browser_batch` wherever possible. Close the tab when done.
- Current budget (set 2026-10-15): **825 Connects over 5 working days = 165 Connects per day, about 6 boosted proposals a day.** Scan posts max **8 cards** so Kasper can pick the best ~6. Submit stops once **today** has spent 165 Connects (tracked by the script across runs). Skip any job costing more than 25 Connects to apply.

Helper script: `node .claude/skills/upwork-proposals/upwork.cjs <cmd>`. **Always single-quote job ids** (`'~0221...'`), zsh expands a bare `~` (Slack channel C0C9JHB59FU, seen list in `~/.upwork-proposals/seen.txt`).

Javascript output rule: never return URLs or `key=value` strings from page scripts (the extension blocks the whole result). Every snippet below strips `= ? &` from text it returns via `c()`. If a result still comes back BLOCKED, rerun with shorter slices, never fall back to screenshots.

---

## upwork scan

### 1. Search (one page per query, Upwork does the first filtering)

Base URL, swap in each query:
`https://www.upwork.com/nx/search/jobs/?q=QUERY&contractor_tier=3&payment_verified=1&proposals=0-4,5-9,10-14,15-19,20-49&sort=recency&per_page=50`

Queries: `cold%20email`, `lead%20generation`, `appointment%20setting`, `outbound%20sales`

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
 const drop= spent<10000 ? 'spent' : BAD.test(loc) ? 'country' : (top!==null && (fixed? top<2000 : top<40)) ? 'budget' : '';
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
 connects:(body.match(/Send a proposal for: (\d+) Connects/)||[])[1],
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
3. **Can pay:** client spend, budget/rate, company size, deal value implied by the offer. Must comfortably afford a premium done-for-you service.
4. **Strong website:** professional, clear, credible (real product, clients, proof). "Not verified" = 3 at most, and the card must say so.
5. **GREAT offer:** clear, specific, high-value outcome for a defined buyer, with proof or a reason to buy now. Vague "we do marketing" or commodity offers score low.

**Gates:** drop if criterion 1 or 3 is below 4, or ANY criterion is 2 or lower, or the total is under 18/25. Rank by total. Put the scores in the card's `why` line, e.g. `Intent 5 · TAM 4 · Pay 5 · Site 4 · Offer 4 = 22`, plus one short reason.

**Client first name:** look in `history` for freelancer reviews that name the client ("working with Chris", "Thanks Sarah"). Only use a name if exactly one name clearly refers to the client. Several names or any doubt → no name.

### 4. Draft (max 8)

Pick the template below that best fits the post (rotate, do not use the same one for every card). Rules:
- Opener: `Hi <FirstName>, I'm Kasper.` ONLY when the name is certain (one name, clearly the client). Any doubt (several names, unclear who) → `Hi, I'm Kasper.`
- **Nothing unverifiable.** Every statement about the client must be stated in their post or profile. No guesses about their company, market or situation. Never call us a "small team".
- Replace `[personal line]` with ONE short sentence about something specific in their post (their market, their goal, a detail they mentioned). It must prove we read the post. Never invent facts about Kasper.
- Keep the template structure: who we are, approach, social proof, call question. Short sentences, everyday words.
- Say "call", never "Upwork call". No links, no email addresses, no phone numbers.
- **Never mention any price, fee amount or per-meeting amount.** Only the pricing model wording already in the templates.
- No em dashes or en dashes.
- Only these facts may be claimed: Agency Evolution books sales calls for B2B companies through cold email and LinkedIn; we handle the list, writing, sending and replies; pay per qualified lead that shows up, no retainer; campaigns go live day one; first lead usually within about 30 hours, setup fee refunded if no lead in 30 hours; our most recent client had 18 calls booked in under 20 days, all interested leads fitting their exact ICP (case study in portfolio); we take on max 20 clients at a time; we handle the targeting and positioning, manually verified decision-maker lists, the technical side (domain warm-up, multiple mailboxes, SPF/DKIM/DMARC, deliverability monitoring) and A/B testing; we work with M&A firms, B2B SaaS, e-commerce brands and professional service firms.
- Screening questions: answer each in 1 to 3 sentences using only the facts above. If a question needs a fact we don't have, answer `[KASPER TO ANSWER]`.

Templates:

**T1**
Hi, I'm Kasper. I run Agency Evolution. We book sales calls for B2B companies. In plain terms, we find the right people for you, reach out by email and LinkedIn, and put the ones who are interested on your calendar. [personal line]

Your post sounds like exactly that kind of work. We take care of the list, the writing, the sending and the replies, so all you do is show up to the calls.

Our most recent client had 18 calls booked on their calendar in under 20 days, all interested leads who fit their exact ICP. The full case study is in my portfolio.

Would you be up for a quick call this week?

Kasper

**T2**
Hi, I'm Kasper. I run outbound for B2B companies, which basically means I fill their calendars with sales calls so they don't have to chase leads themselves. [personal line]

The way we charge is a bit different. You pay per qualified lead that shows up to a call with you, not for emails sent or hours worked, and there's no retainer.

Campaigns go live on day one, and if you don't get a first lead within 30 hours, we refund the setup fee. There's a case study in my portfolio if you want to see real numbers.

Happy to walk you through how it would work for you. Got time for a short call this week?

Kasper

**T3**
Hi, I'm Kasper. I run an outbound agency called Agency Evolution. We don't sell lists. We do the outreach ourselves and only put people who've said yes on your calendar. [personal line]

I mention that because a lot of people who post jobs like this have been burned before, paying for "leads" that never turned into a single call. With us, you only pay for qualified leads who actually show up.

Our most recent client had 18 calls booked on their calendar in under 20 days, all interested leads who fit their exact ICP. The full case study is in my portfolio.

We only take on 20 clients at a time, so I'd like to hear about your business first. Could we do a quick call?

Kasper

**T4**
Hi, I'm Kasper. I help B2B companies get more sales calls, and my team handles all the outreach behind it. [personal line]

We build the list, write the emails and LinkedIn messages, send them, deal with the replies and book the interested ones onto your calendar. You pay per qualified lead that shows up, with no retainer.

It tends to move fast. Campaigns go out on day one, and the first lead usually comes in within 30 hours. Our most recent client had 18 calls booked on their calendar in under 20 days, all interested leads who fit their exact ICP. The full case study is in my portfolio.

If that sounds like what you're after, I'd be glad to jump on a quick call.

Kasper

**T5**
Hi, I'm Kasper. I run Agency Evolution, where we book sales calls for B2B companies through cold email and LinkedIn. [personal line]

Before telling you whether we can help, I'd want to know two things: who's your ideal client, and how many new ones could you take on each month?

I ask because we only work with 20 clients at a time and prefer to stay with them long term, so a quick fit check saves us both time. Our most recent client had 18 calls booked on their calendar in under 20 days, all interested leads who fit their exact ICP. The full case study is in my portfolio.

Are you free for a short call?

Kasper

### 5. Post

Write the cards to the scratchpad as `cards.json`:
`[{"id":"~0221...","title":"...","type":"Hourly $40-$80 | Expert","budget":"","client":"$816K spent, 68% hire, US","proposals":"Fewer than 5","connects":17,"why":"one line on fit","draft":"...","answers":[{"q":"...","a":"..."}]}]`

Then `node .claude/skills/upwork-proposals/upwork.cjs post <path>/cards.json`, then `upwork.cjs mark <every evaluated id>` (see step 1), close the tab, and reply in 3 lines max: cards posted, jobs filtered out, connects balance if seen.

---

## upwork submit

1. `upwork.cjs spent` gives Connects already spent today; if 165 or more, say so and stop. Then `upwork.cjs approved` lists approved, unsubmitted cards, oldest first. `text` already includes a full-text edit from the thread. If `notes` is non-empty, apply those short instructions from Kasper to `text` yourself (keep every draft rule: no prices, nothing unverifiable, no dashes, no links). `answers` already include his `A1:` overrides. None approved → say so and stop.
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
   - Fixed-price jobs: choose "By project", and if a duration select is required pick "1 to 3 months". Use `find` + click for these, no screenshots.
   - **Boost every submitted proposal** (Kasper approved each one). Target 4th place. If the boost text shows a bid for 4th place, set bid = that + 1. If fewer than 4 bids exist, bid the minimum Upwork shows. Skip boosting if the bid would be over 10 Connects. Click "Set bid" after typing.
   - Daily cap: if `spent` today + send + boost would go over 165, stop the run and leave the rest approved for tomorrow (first try without boost if that alone fits). Check `send` + boost ≤ `balance`. If not → `fail` with "not enough connects" and stop the whole run.
4. Click the "Send for N Connects" button (`find` it, then click). Then verify with one JS read that the page shows a confirmation or navigated away from `/apply/`. If a captcha, login or unexpected dialog appears, take ONE screenshot, `fail` the card with what you saw, and stop the run so Kasper can handle it.
5. On success: `upwork.cjs done <ts> <send + boost connects>` (records today's spend).
6. Close the tab and reply in 2 lines max: submitted N, failed N (with reasons), connects left.

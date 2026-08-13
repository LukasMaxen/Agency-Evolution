---
name: reply-approval-sweep
description: Get the #reply-approval queue up to date — review each pending AI-drafted reply against its thread, fix or route the bad ones, and send the good ones. Invoke when the user says "run reply approval sweep", "get me up to date on reply approval", "check reply approvals", or similar. Runs deterministic guards that make double-emailing impossible.
---

# Reply Approval Sweep

Three static scripts do all the I/O (Slack, Postgres, EmailBison) and run the guards. Your only job is to **review each draft and decide**, then write a tiny `decisions.js`. Do not re-implement the scripts or the guards — just run them.

Scripts live in this skill dir. Work dir = `/tmp/reply-approval-sweep` (holds `pulled.json` + `decisions.js`).

## Workflow (4 steps)

```bash
# 1. Pull unhandled cards (prints the pending list + WORKDIR)
node .claude/skills/reply-approval-sweep/pull.cjs

# 2. Print every card's thread + current draft
node .claude/skills/reply-approval-sweep/view.cjs
```

3. **Review each card** (see Decision rules) and classify it: **SEND** (draft is good as-is), **REWRITE** (fixable defect), **MANUAL** (needs a human), or **SKIP** (don't reply). Then **Write** `/tmp/reply-approval-sweep/decisions.js`:

```js
module.exports = {
  // only cards that need a fixed body; everything else sends as-is
  rewrites: {
    "lead@email.com": `Hi X,

Fixed body here.

{SENDER_EMAIL_SIGNATURE}`,
  },
  skip: [ "leadA@x.com" ],          // don't send (not-interested / unsubscribe / already handled by you)
  manual: {                          // post to #manual-replies with a reason, don't auto-send
    "leadB@y.com": "why a human is needed",
  },
};
```

```bash
# 4. Send (runs all guards). Reports sent / rewrites / manual / skipped / failed.
node .claude/skills/reply-approval-sweep/sweep.cjs
```

Only include a lead in `rewrites`/`manual`/`skip` when it needs it. Anything not listed sends its original draft as-is (still guarded). Keys are the lead's `lead_email` from the view, lowercase.

## The guards (automatic in sweep.cjs — never bypass, never re-derive)

Every card passes these before any send; a hit skips/blocks it:
1. **We already replied (DB):** our last `sent_emails` (lead or pref addr) is newer than their last inbound → skip. This alone makes double-emailing impossible even if the queue looks stale.
2. **Peter in thread:** `barsoom|pbarsoom|nukafoods|1906newhighs` anywhere in the thread → skip.
3. **Live EmailBison "we spoke last":** the newest message in the real EmailBison thread is in our `Sent` folder (catches a teammate's manual reply not yet in the DB) → skip.
4. **Duplicate body:** the exact normalized body was already sent in 30 days → skip.
5. **FLAG (block, not send):** fabricated day-times ("Monday at 10am"), retired/wrong links (`lukasmaxen/`, `larsen-digital-marketing/intro`), or angle-bracket links.
6. **bannedFig (block):** Motel Margarita / KyiKyi / Headwaters or banned figure patterns.

So the model never needs to check "did we already reply" by hand — but still review threads for quality.

## Decision rules (what to catch when reviewing)

Send the draft as-is unless it trips one of these:

- **Describe-back → REWRITE.** Remove researched details about the lead's business (revenue, product specifics, certifications, locations, "what made X stand out"). Only reference what the lead told us.
- **Unapproved case-study stat → REWRITE.** The ONLY allowed anonymous results are **"$0 to $850k/month in 4 months"** and **"$152k to $1.1M/month in 13 months"** (+ the page https://www.larsendigitalmarketing.com/case-studies). Any other stat (e.g. "$13M→$35M") → swap to an approved one. Never name a client brand.
- **Fees/pricing.** Never volunteer or quote. Larsen: "happy to walk through on a call." Internal-campaigns (Agency Evolution): **"performance basis, you pay per relevant introduction"** — NEVER "success fee / per closed deal / you only pay when a deal closes." GN Motion when the lead insists on a price → **MANUAL** (can't verify real pricing).
- **Wrong Calendly link → REWRITE.** Correct set:
  - Larsen growth / default (operating partner): `https://calendly.com/d/dtm8-3nx-vr9/intro-call-operating-partner`
  - Larsen sell-side / M&A (add "I'll set you up with Lukas Maxen, our Head of Corporate Development…" unless the sender IS Lukas): `https://calendly.com/d/dvqt-b8q-ytq/m-a-conversation-larsen-digital`
  - ACT Capital: `https://calendly.com/jzanardi-actcapitaladvisors/45-minute-meeting`
  - Internal buy-side (PE lead): `https://calendly.com/lukasm-acceler8rs/buy-side-mandate-conversation`
  - Internal seller / deal-gen: `https://calendly.com/lukasm-acceler8rs/m-a-consultation`
  - NEVER: `maxenlukas/*`, `larsen-digital-marketing/intro`, `lukasmaxen/*`. Dealgen Partners campaigns get no link (→ MANUAL).
- **Below the $5M floor (Larsen/Acceler8rs) → SEND** an honest hedge: not a hard cutoff, trajectory/margins matter, worth a call; or pivot to the growth track (operating-partner link). Don't claim a definite fit.
- **Buyer identity question → SEND** a generic answer (private investment group, committed capital, long-term, open on structure), kept confidential until NDA / mutual interest. Never name a real buyer or the sell-side target company.
- **Yes to an artifact** (case study / teaser / deck) → deliver that artifact, not a generic overview.
- **Redirect** (lead points to a colleague/banker) → the processor sets `pref`; the draft should address the new person; sweep sends to `pref`. Don't reply to the original acknowledging the redirect.
- **Answer the question, don't dodge** — but never fabricate. If you can't answer truthfully (buyer's stance on a category, a specific fee, a specific named buyer) → **MANUAL**.
- **→ MANUAL:** cannabis/hemp (verify buyer stance first), off-ICP (services / B2B SaaS / nonprofit / not a consumer brand), distressed / ceased-operations / already-acquired, sensitive situations, or any claim you can't verify.
- **→ SKIP:** clear not-interested / "unsubscribe" / "stop". ("Not now / maybe later" → a brief gracious close is fine, usually no link.)

## House style (all sent replies)
- No em/en dashes anywhere.
- End with `{SENDER_EMAIL_SIGNATURE}` (the sweep resolves it); no "Best," before it.
- Blank line between paragraphs. Never hand-write a specific day/time, always the Calendly link, UNLESS proposing a verified live slot (see below).

## Proposing specific times (Larsen only, reinstated 2026-08-13)

For Larsen (`larsen-digital` / `acceler8rs`), you may propose real times pulled from `calendly-verify.cjs`'s `getLiveSlots(clientSlug, tz, daysAhead, wantMA)`, which already filters to 8am-8pm in the given timezone:
1. Resolve the lead's timezone: explicit statement/city from the lead always wins; otherwise infer from company location.
2. Call `getLiveSlots` for that timezone. Never hand-pick a time outside its output, never assume a lead-proposed day/time is actually free, check it.
3. Put the chosen slot(s) in `decisions.js` as an object instead of a plain string: `rewrites: { "lead@x.com": { body: "...", slots: [{ iso: "2026-08-18T14:00:00Z", tz: "Europe/Copenhagen", wantMA: false }] } }`. `wantMA: true` for the M&A/sell-side event type.
4. `sweep.cjs` re-verifies every listed slot live at send time and blocks the card if any slot no longer checks out, don't skip this by writing a plain string body with a day+time phrase, that path is a hard block with no exceptions.
5. If no live slot exists in the window, don't invent one, fall back to Calendly-link-only.

## Token efficiency
- Run the 3 scripts; don't paste their code or re-explain the guards.
- Put a body in `rewrites` ONLY for cards you're actually fixing. Everything clean sends automatically.
- One `view.cjs` read is enough to decide the whole batch; then one `decisions.js` write; then `sweep.cjs`. That's it.

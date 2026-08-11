# Manual Replies Sweep

Cleans the #manual-replies Slack channel (`C0B0MMMMNKZ`). Triggers on: "clean up manual replies", "clear manual replies", "check manual replies for already-responded threads". Companion to the `reply-approval-sweep` skill (that one drafts/sends #reply-approval cards; this one cleans up #manual-replies, which is a queue of things the auto-reply system couldn't draft at all).

Do not re-derive this logic from scratch or write ad-hoc `node -e` one-liners. Run the scripts.

## Workflow

```bash
# 1. Pull every unhandled (no-reaction) card, classify it, print a report.
node .claude/skills/manual-replies-sweep/pull.cjs

# 2. Delete everything pull.cjs flagged as auto-delete (see categories below).
node .claude/skills/manual-replies-sweep/clean.cjs

# 3. OPTIONAL — for "needs review" cards you're confident enough to actually answer
#    (see decision rules below), write WORK/sends.json and run send.cjs:
node .claude/skills/manual-replies-sweep/send.cjs
```

Work dir: `/tmp/manual-replies-sweep` (`pulled.json`, optionally `sends.json`).

## The two-bucket split (from `pull.cjs`)

**Auto-delete candidates** (`clean.cjs` deletes these, no review needed):
- `alreadyResponded` — our latest `sent_emails` entry is newer than the latest inbound, checked across **every address in the thread**: the lead's email, `preferred_recipient_email`, AND the live EmailBison from/to/cc list (`GET /api/replies/{id}`). Checking only `lead_email` misses real cases — CC'd founders, brokers representing the lead, and redirect targets often carry the actual reply, not the original address.
- `isPeter` — Peter Barsoom (`barsoom|pbarsoom|nukafoods|1906newhighs`), the standing cross-client exclusion.
- `isNoise` — pure automated content, not a real lead reply: CSAT/star-rating survey emails (`nysonik.com`, "rate your experience", "how was your experience"). Generic bulk out-of-office autoresponders with **no named redirect contact** also count as noise (nothing to act on). An OOO **with** a named person to redirect to is NOT noise, see below.
- `meetingScheduled` — a live row in the `calls` table for any address in the thread.
- `supersededByDecline` — the lead sent a LATER message (any address in the thread, after this card's `received_at`) that already reads as `not_interested`/`unsubscribe`/`hard_no`/`wrong_target` (via `ai_analysis->>'intent'`). Whatever question this older card raised (pricing, ICP fit, timing) is moot, they walked away after asking it. Don't leave it open waiting on a decision nobody needs.

`pull.cjs` also prints each "needs review" card's age and flags anything ≥7 days old as `[STALE]`, sorted oldest-first. A stale card usually means either a missed opportunity (a lead who was ready to book and got dropped) or a dead one, worth a quick human glance either way rather than sitting unsorted in the middle of the list.

Every deletion is logged to `1. Departments/operations/manual-replies-deleted-log.md` BEFORE the Slack message is deleted (`chat.delete` is irreversible, and the card's reasoning text — why the auto-reply system routed it to manual in the first place — only lives in that message). If anyone later asks "why did that card disappear," check the log, don't guess.

**Needs review** (leave alone, do not delete, do not fabricate an answer):
- Off-ICP scope calls (services business, nonprofit, wrong category, below revenue floor) — these need a real "do we pursue this" decision. Exception: a nonprofit with no revenue history transitioning to for-profit is an automatic decline (precedent set 2026-08-11, AHVets) — clear it without a reply, don't ask again for that exact pattern.
- Unverifiable facts or figures (pricing, fund track record, buyer's stance on a category like cannabis/hemp, an unconfirmed company detail) — never invent these. If the user later confirms a fact (e.g. "GN Motion is based in France, works worldwide"), answer the specific question that was asked, send it, and **save the confirmed fact to the client file** (`clients/{slug}.md`) so it's not flagged again.
- Specific day/time booking requests, sensitive/distressed situations (ceased operations, already acquired, financial distress) — human judgment call.
- A redirect to a **named** person or department with a real, unresolved ask (colleague, dept mailbox, new company contact) — see "confident sends" below before leaving these all as manual toil.

## Confident sends (skip the manual-toil default when you can)

Some "needs review" cards are actually safe to draft and send yourself, not because they're noise, but because the answer requires no unverifiable fact and no business-scope judgment call, just execution:
- A referral/redirect to a **named** contact (a colleague, a department mailbox, a departed employee's replacement) where the ask is just "forward this to them." Draft a short reply: greet the new person (or "Hi team" for a dept mailbox), one line acknowledging the intro, if it's a brand-new company/domain contact with zero context add one brief line of what we do (reuse the original cold email's value prop), then the Calendly link if relevant. CC the person who gave you the redirect. This exact pattern is also now baked into the live auto-reply processor (`app/api/auto-reply/processor.ts`, REFERRAL HANDOVER PATTERN) as of 2026-08-11, so going forward most of these should auto-draft into #reply-approval and never reach #manual-replies as a stuck card in the first place. If one still shows up here anyway (older card, or the live system missed it), it's safe to draft and send it yourself.
- A plain acknowledgment where nothing is actually being asked (e.g. "I forwarded your email internally, they'll reach out if interested") — a short, claim-free "thanks for passing it along" closes the loop, no CTA, no links needed.
- A closed-loop "sounds good!" after we already sent everything relevant — a one-line warm close, or just leave it if truly nothing to add.

For any of these, write the send job(s) to `WORK/sends.json` as an array:
```js
[{ leadEmail: "original-lead@x.com", to: "recipient@y.com", toName: "Name or null", cc: ["original-lead@x.com"], body: `Hi ...\n\n...\n\n{SENDER_EMAIL_SIGNATURE}`, ts: "slack-message-ts-to-delete-after-send" }]
```
Then run `send.cjs`. It re-checks the already-replied and duplicate-body guards fresh before sending (a stale sends.json can't double-email someone), and deletes the Slack card automatically on success.

## Never delete a real live opportunity

Off-ICP calls, pricing questions, category-gating (cannabis/hemp), track-record questions, and "is this real" skepticism from an interested lead are NOT clutter, they're revenue-bearing decisions only Lukas/Kasper can make. Deleting them doesn't save time, it hides work. Only delete what `pull.cjs` classifies as auto-delete, or what you've actually resolved via `send.cjs`. When genuinely unsure whether something is noise or a live opportunity, leave it and say so, don't guess.

## Gotchas (learned the hard way, 2026-08-11 session)

- **Reactions vs. deletion.** `SLACK_BOT_TOKEN` (`.env.local`) is the SAME app identity that posts these cards (bot `vs_code_access`, user `U0B22QXPY9J`, confirmed via `auth.test`), so `chat.delete` via that token works on its own messages. The `mcp__slack__slack_add_reaction` MCP tool posts as a DIFFERENT app identity (`Claude Bot`, user `U0B0U5EEZJR`) — a reaction added through that tool **cannot be removed** with the direct `SLACK_BOT_TOKEN` API calls (cross-app reactions can't be pulled by a different app). Prefer `chat.delete` over reacting for anything you've resolved; if you mis-react, don't fight it, just post a corrective thread reply so it isn't silently missed.
- **A reaction from anyone (teammate or bot) means "already handled."** Never re-process a card that already has a reaction, even if you can't find a matching `sent_emails` row — a teammate may have replied through a CC'd address or directly in EmailBison's UI, which doesn't always get logged. Trust the reaction.
- **Same broker, multiple workspaces.** A broker/advisor representing a client (e.g. "NP Capital Advisors" for one portfolio company) can appear across TWO separate campaigns/workspaces with the SAME `preferred_recipient_email` but different `replies.id` rows. Checking only the current workspace's thread misses that we already engaged them elsewhere. `pull.cjs` checks `sent_emails` by address globally (not scoped to one workspace) for exactly this reason.
- **Channel ID:** `#manual-replies` = `C0B0MMMMNKZ`. Source of truth is `lib/slack-approval.ts` (`MANUAL_REPLIES_CHANNEL`, defaults to `"#manual-replies"` unless `MANUAL_REPLIES_SLACK_CHANNEL` env var is set) plus the actual Slack channel list — don't trust a memory file's channel ID without spot-checking it's still current.
- **Card formats, two shapes:** (a) plain-text `:handshake: *Needs manual action*\n{reason}\nLead: {name} <{email}> | {company}\nEB reply: {ebId}` (posted by `reply-approval-sweep`'s own `sweep.cjs` when routing to manual), and (b) Block Kit cards from `processor.ts`'s `buildCard()` — headers like "Manual handling needed" / "Interested reply needs human review" / "Couldn't draft a reply — needs human" / "EmailBison refused mark-as-interested", with an "Open in EmailBison" link containing the internal `replies.id` UUID at `/inbox/replies/{uuid}`. `pull.cjs` handles both.

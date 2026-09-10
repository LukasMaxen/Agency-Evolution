---
name: onboard-client
description: Onboard a new EmailBison client (or a new workspace for an existing one) into the AI Reply Desk end-to-end -- collect what's needed, wire the DB/webhook/automation-tier/Calendly, and verify it all actually works before calling it live. Invoke when the user says "we're onboarding a new client", "onboard [client]", "new workspace for [client]", or starts pasting intake info for a new client.
---

# Onboard Client

Three scripts do the DB/API I/O so you never hand-write SQL or guess at code state. Your job is to run the intake conversation, make the calls a script can't make (slug, automation tier, whether to alias another client's content), and execute the checklist in order.

Scripts live in this skill dir, run from the repo root:
```bash
node .claude/skills/onboard-client/checklist.cjs <slug>   # read-only status check, run this FIRST and after every change
node .claude/skills/onboard-client/setup.cjs <slug> "<Display Name>" <api_key> <instance_url>   # upsert the DB row, idempotent
node .claude/skills/onboard-client/test.cjs <slug>         # end-to-end verify, no Slack post, no real lead touched
```

## 1. Intake -- one consolidated ask, not a drip of questions

Read whatever the user already pasted/said first. Only ask for what's genuinely missing, and ask it **all at once** (batch questions, don't go round-trip by round-trip -- this is the token/usage-efficiency requirement):

- **Identity:** client name, slug (kebab-case, matches the EmailBison workspace name), Slack channel name, primary contact (name/role/email)
- **Commercial:** offer in one sentence, monthly retainer, value prop
- **ICP:** industry, titles, company size, geography, revenue range, what qualifies/disqualifies a lead
- **Rules:** preferred tone, anything they can never say or promise
- **Booking:** Calendly link, Fillout, iClosed, or none yet
- **EmailBison:** which instance (`send.emailagencyevolution.com` is the default; `send.shieldsoutbound.com` only if explicitly told), and whether the workspace already exists there or still needs to be created
- **Is this a second workspace for an existing client?** (e.g. a client migrating instances, like Austin Heaton / WithPebble in Sept 2026) -- if yes, get the existing client's slug so you can alias its content instead of re-writing everything
- **Automation tier:** fully-automated (zero human review -- currently only Larsen Digital, Acceler8rs, ACT Capital) vs standard (every interested/needs_info reply goes to human review in #reply-approval/#manual-replies). **Default to standard** unless the user explicitly asks for full automation -- it's the higher-blast-radius option (unreviewed sends to real leads) and should never be silently assumed.
- **Airtable meetings tracker needed?** If yes, get the base id.

Do not run the full 35-question GTM/campaign interview inline here -- that's `1. Departments/operations/SKILL_IntakeClient.md`, a separate deep interview for campaign copy and case studies. This skill's job is to get the client **wired and verified**, not to write the full client file content. Point the user to that skill afterward if the client file needs the full GTM brief.

## 2. Check current state

```bash
node .claude/skills/onboard-client/checklist.cjs <slug>
```

This tells you, for a slug that may or may not exist yet, what's already true in the DB and codebase (workspace row, client file + required `## REPLY QUICK REFERENCE` heading, alias, automation tier, Calendly config) plus which lists are DB-driven with no action needed (self-sweeper, CSM update, sender-sync) versus genuinely dead columns to ignore (`workspaces.calendly_token`, `workspaces.auto_reply_approval_mode`). Never grep processor.ts by hand for this -- the script already knows where to look.

## 3. Wire it up, in order

1. **Get the EmailBison workspace + API key.** This step is manual -- either the user creates the workspace in the EmailBison dashboard themselves, or hands it to whoever does, and pastes back the API key + confirms the instance URL. You cannot create the EmailBison workspace itself.
2. **DB row:**
   ```bash
   node .claude/skills/onboard-client/setup.cjs <slug> "<Display Name>" <api_key> <instance_url>
   ```
3. **Client file.** If this is a genuinely new client, write `clients/[slug].md` from `clients/_template.md` with at minimum the `## REPLY QUICK REFERENCE` section filled in (exact heading, required). If this is a second workspace for an existing client, **do not duplicate the file** -- add an alias instead:
   - Edit `CLIENT_FILE_ALIASES` in `app/api/auto-reply/processor.ts` (near the top): `"<new-slug>": "<existing-client-slug>"`.
4. **Automation tier.** Only if the user explicitly asked for full automation, add the slug to `FULLY_AUTOMATED_WORKSPACES` in `processor.ts`. Say back what this means (auto-sends interested/needs_info with no human review) before making the edit -- confirm, don't assume.
5. **Booking tool:**
   - Calendly: add an entry to `CALENDLY_CLIENT_CONFIG` in `lib/calendly.ts` (`tokenEnv`, `eventTypeUrl`, `defaultTz`). If reusing an existing client's Calendly account (e.g. a second workspace for the same person), reuse their `tokenEnv` rather than asking for a new token. If it's a genuinely new Calendly account, the user needs to add a new env var (`.env.local` locally, and the Coolify project env vars for production) and give you its name.
   - Fillout / iClosed: these use a separate webhook pattern, not Calendly -- check `project_withpebble_fillout_meetings` / `project_gn_motion_iclosed_gap` memory for the pattern and confirm with the user before assuming which one applies.
   - None yet: skip, plain-link-only behavior is the safe default (no fabricated times, ever).
6. **Airtable meetings tracker**, if requested: follow the pattern in `project_meeting_tracker_inapp.md` (memory) -- Calendly/Fillout/iClosed webhook writes to Airtable + posts to a Slack channel, dedup by email.
7. **Give the user the exact webhook to register in EmailBison** (this cannot be automated -- no known EmailBison API for webhook registration):
   - URL: `https://inbox.agencyevolution.eu/api/webhook/<slug>`
   - Events: `LEAD_REPLIED`, `CONTACT_INTERESTED`, `CONTACT_UNSUBSCRIBED`, `EMAIL_SENT`, `MANUAL_EMAIL_SENT`, `EMAIL_OPENED`, `EMAIL_BOUNCED`, `CONTACT_FIRST_EMAILED`

## 4. Verify before calling it done

```bash
node .claude/skills/onboard-client/test.cjs <slug>
```

Only after the webhook is registered in EmailBison. This checks EmailBison auth, fires one synthetic `LEAD_REPLIED` event at the real production webhook, confirms the row lands under the right `workspace_slug`, and deletes it before the 2-minute auto-reply hold could turn it into a real Slack post. All four checks must pass. If any fail, do not tell the user the workspace is live.

## Expected, not a bug: Account Monitor stays empty until warmup starts

The "Account Monitor" tab (`components/MailboxMonitor.tsx`, backed by `/api/warmup-monitor`) only lists workspaces with a row in `emails_sent` in the trailing 7 days (real sends or warmup probes). A brand-new workspace with no sender accounts added / warmup not started yet in EmailBison will not appear there, no matter how correctly it's wired in our DB. It shows up on its own once warmup begins and the `EMAIL_SENT` webhook starts logging probe sends -- don't chase this as a bug during onboarding, it's Step 5 (domain/sender setup) not done yet, not Steps 2-4 (DB/webhook/routing) covered by this skill.

## 5. Final report

One consolidated checklist: what's done (wired + verified), what's still needed from the user (webhook registration if not done yet, Coolify env var if a new Calendly token was added), and what's still manual/out of scope for this skill (domain + sender warmup, DNS records, contract/invoice, lead sourcing, campaign copy, the full GTM-brief client-file interview). Pull the "still manual" list from `1. Departments/operations/SKILL_OnboardClient.md` steps 5-10 rather than re-deriving it.

## Token efficiency

- One intake message covering everything in section 1, not a question per message.
- Run `checklist.cjs` instead of grepping `processor.ts`/`lib/calendly.ts` by hand.
- Don't paste the scripts' code back to the user or re-explain what they do -- just run them and report the result line.
- Don't run the full `SKILL_IntakeClient.md` interview as part of this flow -- that's a separate, later step for campaign content, not required to get a workspace wired and verified.

# Campaign QA — Pre-Launch Checklist

> **Status: Needs Kasper's review.** The checklist below contains some correct rules but does not fully reflect the actual QA process. Kasper to update this with the complete, accurate pre-launch process before this skill is considered live.

Run this before pushing any sequence update or launching a new campaign. Check every step and every variant.

---

## Copy Rules

- [ ] No dashes of any kind used as punctuation (em dash, en dash, or hyphen as dash)
- [ ] No colons in email copy
- [ ] No {COMPANY} variable — must use "your brand" for Acceler8rs
- [ ] No rounded numbers — use specific figures ($6,342 not $6k)
- [ ] No P.S. opt-out lines in Acceler8rs scripts
- [ ] Guarantee language present in Step 1 and Step 3 (where applicable)

## Audience & Currency

- [ ] Currency matches audience: £ for UK campaigns, $ for US/global
- [ ] Case studies match currency (Motel Margarita + KyiKyi = UK £, General = US $)
- [ ] ICP and targeting match the copy angle

## Structure

- [ ] CTA matches step: Step 1 = call or case study ask, Step 2 = short re-engage, Step 3 = case study offer
- [ ] Wait days correct: typically 7 days between Step 1 and 2, 1 day between Step 2 and 3
- [ ] Thread reply steps (Step 2, Step 3) do NOT include "Re: " in the subject — EmailBison adds it automatically

## EmailBison Push Rules

- [ ] All steps have a unique `order` value (EmailBison requires this even for variants)
- [ ] Variants correctly reference their parent step via `variant_from_step_id`
- [ ] Workspace slug is correct for the client
- [ ] Campaign name and sequence title match

## Split Testing and Campaign Lifecycle

- [ ] If testing a new concept or angle: launch a new campaign. Old campaign's interested rate is the baseline. Do not run a frozen control variant in parallel.
- [ ] If adding leads to an existing campaign: confirm campaign is under 70% contacted and performing above KPI thresholds.
- [ ] See full lifecycle rules in CONTEXT_Campaign.md → Campaign Lifecycle section.

## Deliverability — Variant Refresh

- [ ] Check sends per variant body before pushing. Refresh thresholds: 500 sends = light refresh, 2,000 sends = moderate refresh.
- [ ] If reply rate has dropped >20% from campaign baseline: refresh all variants immediately before investigating anything else.
- [ ] All variants within a campaign must be meaningfully different from each other (65–70% different in wording and visual structure).

---

## Sign-off

Push only after all boxes are checked. For active campaigns, confirm the update with Lukas before pushing.

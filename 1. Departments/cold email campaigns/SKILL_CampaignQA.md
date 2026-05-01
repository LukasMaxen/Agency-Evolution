# Campaign QA — Pre-Launch Checklist

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

## Split Testing

- [ ] If updating an existing concept: Step 1A kept as control (original copy untouched), new copy applied to Step 1B onward
- [ ] If testing a new concept entirely: duplicate the campaign, keep original paused as baseline, launch new campaign as the test

---

## Sign-off

Push only after all boxes are checked. For active campaigns, confirm the update with Lukas before pushing.

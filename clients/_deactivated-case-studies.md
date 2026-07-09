# Deactivated Case Studies (archive)

Case studies removed from active client files so the auto-reply drafter cannot use them.
To REACTIVATE, tell Claude "reactivate the [name] case study for [client]" and it will paste the exact lines below back into the client file locations noted.

---

## Motel Margarita + KyiKyi (removed from Acceler8rs on 2026-07-07)

**Reason:** Requested fully deactivated. Previously these were Acceler8rs case studies but they were also leaking into Larsen Digital replies (shared DTC-growth offer + infra). Removed from Acceler8rs entirely; also hard-banned for Larsen Digital in `clients/larsen-digital.md`.

**Original location 1 — `clients/acceler8rs.md`, `fu_context:` block (inside REPLY QUICK REFERENCE).**
The line originally read:
```
  Case studies (use exact numbers — specificity builds trust): Motel Margarita (£25k to £102k/month in 90 days), KyiKyi (£13k to £140k/month in 60 days), Headwaters Studio (£60k/year to £1M+ in 24 months). UK campaigns use £, US use $.
```
To restore, re-insert `Motel Margarita (£25k to £102k/month in 90 days), KyiKyi (£13k to £140k/month in 60 days), ` before `Headwaters Studio`.

**Original location 2 — `clients/acceler8rs.md`, "Case studies to reference:" list.**
The two removed bullets were:
```
- Motel Margarita: £25k → £102k/month in 90 days (UK client — use £)
- KyiKyi: £13k → £140k/month in 60 days (UK client — use £)
```

**Exact figures (source of truth for reactivation):**
- Motel Margarita: £25k → £102k/month in 90 days (UK client — use £)
- KyiKyi: £13k → £140k/month in 60 days (UK client — use £)

---

## Headwaters Studio (removed from Larsen Digital + Acceler8rs on 2026-07-08)

**Reason:** Requested deactivated. Headwaters was listed as an approved case study in BOTH `clients/larsen-digital.md` and `clients/acceler8rs.md`, the same cross-client leak shape that got Motel Margarita + KyiKyi removed. Replaced with anonymous results so no named brand crosses between clients.

**Replacements now in use:**
- Larsen Digital: anonymous US results `$0 to $850k/month in 4 months` and `$152k to $1.1M/month in 13 months`, plus the case studies page `https://www.larsendigitalmarketing.com/case-studies`.
- Acceler8rs: anonymous US result `$6,342 to $93,210/month in 4 months (3.75x ROAS)`.

**Exact figures (source of truth for reactivation):**
- Headwaters Studio: £60k/year → £1M+ in 24 months (UK client — use £)

To restore, re-insert the Headwaters line into the `fu_context` block and the "Case studies to reference" list of the target client file, and remove "headwaters" from `BANNED_CASE_STUDIES` in `app/api/auto-reply/processor.ts`.

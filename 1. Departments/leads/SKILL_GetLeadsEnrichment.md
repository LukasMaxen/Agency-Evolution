# Skill: GetLeads Lead Enrichment (LinkedIn URL, standing method)

## Standing rule (locked 2026-09-10)

**Always enrich via LinkedIn URL, never via domain.** Do not default to the domain-based decision-makers batch tool (`create_decision_makers_batch_link`) for enrichment work — that tool exists and works, but domain is no longer our input format going forward. Use the CSV enrichment tool in `linkedin` mode instead, every time, for every client's lead list.

This is a deliberate standing choice, not a one-off for Sonaro. Apply it to every future GetLeads enrichment task without re-deriving the approach or re-checking the format.

---

## Why LinkedIn URL, not domain

Confirmed 2026-09-10: GetLeads' contact export CSVs (e.g. Apollo-sourced Sonaro list) carry a `Company Linkedin Url` column that's populated more completely than `Website` (1,496 of 1,507 rows vs. 1,444 for domain on the same list). LinkedIn URL is also the field the user wants standardized on for all future enrichment, regardless of per-list domain coverage.

**Open item, not yet fully verified:** GetLeads describes CSV enrichment mode `linkedin` as "LinkedIn URL column → finds work email," which reads as built for *personal* profile URLs (`/in/name`), not *company* page URLs (`/company/slug`). Our lead lists only have company page URLs. First live run (Sonaro, 2026-09-10) will confirm whether company-page input actually returns useful decision-maker contacts or comes back empty. **Update this file with the confirmed result the first time a run completes** — do not keep re-flagging this caveat once verified either way.

---

## The locked process (run every time, in this order)

1. **Filter the raw export to ICP first**, before touching GetLeads. Use a client-specific filter script (pattern: `scratchpad/<client>_filter.py`, e.g. `sonaro_filter.py`) that whitelists/blacklists on Company Name keywords. Never send an unfiltered list to GetLeads — wastes credits enriching rows that will be thrown away anyway.

2. **Extract deduped LinkedIn URLs** from the filtered CSV using the reusable script in this folder:
   ```
   python3 "1. Departments/leads/extract_linkedin_urls.py" <filtered_input.csv> <output.csv> ["Company Linkedin Url"]
   ```
   Third arg is optional, defaults to `Company Linkedin Url` (the Apollo export header). Output is a deduped CSV with two columns, `LinkedIn Url` and `Company Name` — never single-column (see gotcha below).

3. **Create the enrichment upload link**, mapped to that exact column name so no manual mapping is needed on the upload page:
   ```
   create_csv_enrichment_upload_link(
       mode="linkedin",
       mapping={"profileUrl": "LinkedIn Url"}
   )
   ```

4. **Share `upload_url`** with the user (expires ~1 hour) and the local output CSV path. They upload it in-browser, no sign-in required.

5. **Poll `check_enrichment_upload`** with `upload_id` until `status` is `queued` and `run_id` is returned.

6. **Poll `check_enrichment_status`** with `run_id` until `status` is `completed`.

7. **Call `get_enrichment_result`** with `run_id` for the presigned download URL (1-hour TTL).

8. **Fetch the file myself** — `curl` the presigned URL directly into `enriched leads/<Client Display Name>/` (e.g. `enriched leads/Sonaro AI/`), never scratchpad, since the enriched CSV is a real deliverable. Use the client's exact display name from `clients/README.md`'s Active Clients table for the folder — 17 subfolders were set up 2026-09-10 (all Active clients plus AH Consulting and WithPebble, per user request even though those two are still "Onboarding"), already in place, don't recreate them. Name the file descriptively with the date, e.g. `Sonaro AI - Clinics Enriched 10th Sep.csv`. The download URL requires no further auth beyond what's already in it, so this needs no action from the user. Only hand the user the raw URL as a fallback if the curl fetch itself fails.

**The whole pipeline needs exactly one manual step from the user: opening `upload_url` once to submit the file.** Everything before and after that — building the input CSV, creating the job, polling both stages, and pulling down the finished result — is fully automated on this end. If asked "do you have the enriched data," the answer is yes once step 8 completes; it's a real file on disk, not just a link waiting to be opened.

---

## Confirmed gotchas (found in production, not theoretical)

- **A single-column CSV fails GetLeads' upload parser outright.** Confirmed 2026-09-10: uploading a CSV with only a `LinkedIn Url` column failed with `"Unable to auto-detect delimiting character; defaulted to ','"`, `items_processed: 0`. The parser needs at least one comma on every line to detect the delimiter. `extract_linkedin_urls.py` now always emits two columns (`LinkedIn Url`, `Company Name`) — never generate a single-column upload CSV for any GetLeads CSV enrichment or batch flow.
- **No MCP tool can submit file contents directly — a one-time browser step is unavoidable.** GetLeads' own docs state explicitly: "Never try to pass CSV file contents through MCP tool calls — always use the upload link for files." Creating the job, polling status, and fetching the result are all fully scriptable via MCP; only the initial upload/paste itself requires the user to open `upload_url` once. Don't imply this can be fully eliminated — it can't, per GetLeads' own design.

## Efficiency rules (token + credit usage)

- **Dedupe before upload, always.** Enrichment bills 1 credit per row processed — never upload a CSV with repeated LinkedIn URLs.
- **Filter to ICP before enrichment, not after.** Enriching rows you're about to discard is wasted credit.
- **Never loop single-company lookups (`lookup_decision_makers`) for a list this size.** That tool is for ≤25 companies. Anything larger goes through the async CSV/batch flow — one upload, one poll loop, not N tool calls.
- **Never paste full CSV contents into chat or into a tool call.** Always write to a real file path and reference the path. If the user says a file is "attached," check `~/Downloads` and other likely local paths for the actual file before manually retyping any of it — see `feedback_getleads_unreliable_filters` sibling memory for the transcription-risk incident this rule comes from.
- **Poll, don't guess.** Don't estimate completion time or fabricate a row count — poll `check_enrichment_status` / `check_decision_makers_batch` until the real terminal status comes back.
- **Reuse this skill's script and mapping verbatim** rather than re-deriving the extraction logic or re-checking GetLeads' upload format each session — the format is confirmed and locked here.

---

## See also

- `feedback_getleads_linkedin_standard` (memory) — the standing decision this skill implements.
- `project_getleads_mcp_setup` (memory) — general GetLeads API/MCP mechanics, including why the domain-based decision-makers batch tool is a separate, no-longer-default path.
- `project_getleads_lead_cleanup_methodology` (memory) — the ICP/cleanup pass to run before this skill, if the target client doesn't already have a dedicated filter script.

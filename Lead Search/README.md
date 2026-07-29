# Apollo Search Machine

Local pipeline: Apollo people search (free) -> hard filter + relevance scoring (pandas, local) -> dedupe against local history -> enrich only the survivors (spends Apollo credits) -> CSV.

## Setup (one-time)

```bash
cd "Lead Search"
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

`.env` already has `APOLLO_API_KEY` set (gitignored, never commit it).

## How a run actually happens

You describe leads in plain English to Claude Code. Claude Code (not this script) translates that into a `filters.json` file using `config/mappings.json` as its memory of title synonyms, industry keyword sets, and exclusion presets, then runs:

```bash
python main.py --filters path/to/filters.json
```

This keeps the natural-language step inside your existing Claude Code session (no extra API calls, no extra cost) and keeps everything else (search, scoring, dedupe, enrichment) as fast local code.

To teach it a new shorthand ("remember that 'ops leaders' means these titles"), just say so — Claude Code edits `config/mappings.json` directly so future runs reuse it without re-explaining.

## filters.json shape

See `example_filters.json`. Top-level keys map straight to Apollo's `mixed_people/api_search` params (`person_titles`, `person_seniorities`, `organization_num_employees_ranges`, `organization_locations`, `person_locations`, `q_organization_keyword_tags`, `person_not_titles`, etc). Two extra blocks are stripped before hitting the API:

- `relevance` — `target_titles`, `target_keywords`, `exclude_titles`, `exclude_keywords`, `threshold` (0-100, default 70). Drives the local scoring pass.
- `max_results`, `enrich_email`, `enrich_phone` — run-level controls.

## CLI flags

```bash
python main.py --filters filters.json                 # full run: search + score + dedupe + enrich + CSV
python main.py --filters filters.json --dry-run        # same, but skips enrichment (zero Apollo credits) — good for testing a new filter shape
python main.py --filters filters.json --threshold 60   # override the relevance threshold from the file
python main.py --filters filters.json --max-results 2000
```

## What happens on each run

1. `mixed_people/api_search` — paginated, credit-free, up to `max_results`.
2. `src/relevance.py` — hard exclusions (`exclude_titles`, `exclude_keywords`) drop rows outright; everything else gets a 0-100 fuzzy score against `target_titles`/`target_keywords`. Rows below `threshold` are dropped.
3. `src/dedupe.py` — checks each survivor against `seen_leads.db` (local SQLite, keyed by LinkedIn URL, else domain+name). Already-seen leads are dropped before they ever reach enrichment.
4. `src/enrich.py` — only the leads that survived steps 2 and 3 go to `people/bulk_match`, batched 10 at a time. Credit usage is logged to `credits_log.json`, totalled per day.
5. Final CSV written to `output/leads_<timestamp>.csv`. Console prints the funnel: raw pulled -> after exclusions -> after threshold -> after dedupe -> final, plus credits spent.

`seen_leads.db` persists across runs — an afternoon run won't re-pull or re-enrich people already seen this morning.

## Files

```
config/mappings.json     title synonyms, seniority presets, industry keywords, exclusion presets — editable memory
src/apollo_client.py     auth header, retry/backoff on 429s and 5xxs
src/search.py            paginated people search
src/relevance.py         hard exclusions + fuzzy relevance scoring
src/dedupe.py            SQLite dedupe log (seen_leads.db)
src/enrich.py            bulk_match enrichment + credit logging (credits_log.json)
src/pipeline.py          orchestrates the full run, writes the CSV
main.py                  CLI entrypoint
example_filters.json     reference filters file
output/                  gitignored — final CSVs land here
```

## Notes

- Search is free; only `enrich_email` / `enrich_phone` spend credits (~1 credit/email, ~8/phone as of 2026 rates), and only for leads that passed relevance + dedupe.
- If Apollo changes a field name in the search or bulk_match response, the code that reads it (`normalize_record` in `pipeline.py`, or the match-parsing loop in `enrich.py`) is the place to fix it — the request payload shape was not fully verified against a live Apollo account beyond a small dry-run search.

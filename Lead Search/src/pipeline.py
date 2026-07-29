import datetime
import json
from pathlib import Path

import pandas as pd

from .apollo_client import ApolloClient
from .dedupe import filter_new, mark_seen
from .enrich import enrich_records
from .relevance import score_people
from .search import run_people_search

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"

OUTPUT_COLUMNS = [
    "name",
    "title",
    "company",
    "company_domain",
    "employee_count",
    "industry",
    "location",
    "linkedin_url",
    "email",
    "phone",
    "relevance_score",
]


def normalize_record(p: dict) -> dict:
    org = p.get("organization") or {}
    return {
        "first_name": p.get("first_name"),
        "last_name": p.get("last_name"),
        "name": p.get("name"),
        "title": p.get("title"),
        "company": org.get("name"),
        "company_domain": org.get("primary_domain"),
        "employee_count": org.get("estimated_num_employees"),
        "industry": org.get("industry"),
        "location": ", ".join(filter(None, [p.get("city"), p.get("state"), p.get("country")])),
        "linkedin_url": p.get("linkedin_url"),
        "email": None,
        "phone": None,
    }


def run_pipeline(
    filters_path: str,
    threshold: float = None,
    max_results: int = None,
    do_enrich: bool = True,
    dry_run: bool = False,
):
    cfg = json.loads(Path(filters_path).read_text())
    relevance_cfg = cfg.pop("relevance", {})
    threshold = threshold if threshold is not None else relevance_cfg.get("threshold", 70)
    max_results = max_results or cfg.pop("max_results", 2000)
    enrich_email = cfg.pop("enrich_email", True)
    enrich_phone = cfg.pop("enrich_phone", False)

    client = ApolloClient()

    print(f"Searching Apollo (target: {max_results} leads, credit-free)...")
    raw = run_people_search(client, cfg, max_results)
    print(f"Pulled {len(raw)} raw records.")

    normalized = [normalize_record(p) for p in raw]

    print("Scoring relevance...")
    df = score_people(normalized, relevance_cfg)
    after_hard = len(df)

    df = df[df["relevance_score"] >= threshold]
    after_score = len(df)
    print(f"After exclusions: {after_hard} -> after threshold ({threshold}): {after_score}")

    records = df.to_dict("records")
    new_records = filter_new(records)
    print(f"After dedupe against seen_leads.db: {len(new_records)} (dropped {len(records) - len(new_records)} already seen)")

    credit_summary = {"emails_revealed": 0, "phones_revealed": 0}
    if do_enrich and not dry_run and new_records:
        print(f"Enriching {len(new_records)} leads (spends Apollo credits)...")
        new_records, credit_summary = enrich_records(client, new_records, enrich_email, enrich_phone)
    elif dry_run:
        print("Dry run: skipping enrichment, zero credits spent.")

    mark_seen(new_records)

    out_df = pd.DataFrame(new_records)
    cols = [c for c in OUTPUT_COLUMNS if c in out_df.columns]
    out_df = out_df[cols] if not out_df.empty else pd.DataFrame(columns=OUTPUT_COLUMNS)

    OUTPUT_DIR.mkdir(exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    out_path = OUTPUT_DIR / f"leads_{timestamp}.csv"
    out_df.to_csv(out_path, index=False)

    print("\n--- Run summary ---")
    print(f"Raw pulled:        {len(raw)}")
    print(f"After exclusions:  {after_hard}")
    print(f"After threshold:   {after_score}")
    print(f"After dedupe:      {len(new_records)}")
    print(f"Final CSV rows:    {len(out_df)}")
    print(f"Credits spent:     {credit_summary['emails_revealed']} email reveals, {credit_summary['phones_revealed']} phone reveals")
    print(f"Output: {out_path}")

    return out_path

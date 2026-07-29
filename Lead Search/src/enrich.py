import datetime
import json
from pathlib import Path

from .apollo_client import ApolloClient

CREDITS_LOG = Path(__file__).resolve().parent.parent / "credits_log.json"
BATCH_SIZE = 10


def _load_log():
    if CREDITS_LOG.exists():
        return json.loads(CREDITS_LOG.read_text())
    return {}


def _save_log(log):
    CREDITS_LOG.write_text(json.dumps(log, indent=2))


def _log_credits(email_count, phone_count):
    today = datetime.date.today().isoformat()
    log = _load_log()
    day = log.setdefault(today, {"emails_revealed": 0, "phones_revealed": 0})
    day["emails_revealed"] += email_count
    day["phones_revealed"] += phone_count
    _save_log(log)
    return day


def enrich_records(client: ApolloClient, records: list, reveal_email=True, reveal_phone=False, verbose=True):
    enriched = []
    email_count = 0
    phone_count = 0

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        details = [
            {
                "first_name": r.get("first_name"),
                "last_name": r.get("last_name"),
                "organization_name": r.get("company"),
                "linkedin_url": r.get("linkedin_url"),
            }
            for r in batch
        ]
        payload = {
            "details": details,
            "reveal_personal_emails": reveal_email,
            "reveal_phone_number": reveal_phone,
        }
        data = client.people_bulk_match(payload)
        matches = data.get("matches") or []

        for orig, match in zip(batch, matches):
            match = match or {}
            if match.get("email"):
                orig["email"] = match["email"]
                email_count += 1
            phones = match.get("phone_numbers") or []
            if phones:
                orig["phone"] = phones[0].get("sanitized_number") or phones[0].get("raw_number")
                phone_count += 1
            enriched.append(orig)

        if verbose:
            print(f"  enriched batch {i // BATCH_SIZE + 1}: {len(batch)} leads")

    day_totals = _log_credits(email_count, phone_count)
    return enriched, {
        "emails_revealed": email_count,
        "phones_revealed": phone_count,
        "today_totals": day_totals,
    }

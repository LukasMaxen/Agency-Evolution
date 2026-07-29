import datetime
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "seen_leads.db"


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS seen_leads (
            dedupe_key TEXT PRIMARY KEY,
            email TEXT,
            linkedin_url TEXT,
            first_seen TEXT
        )
        """
    )
    return conn


def make_key(record: dict) -> str:
    """apollo_id is Apollo's own stable person id, present even on
    un-enriched search results, so it's the primary key. linkedin_url and
    domain+name are only populated post-enrichment and serve as fallback."""
    apollo_id = (record.get("apollo_id") or "").strip() if record.get("apollo_id") else None
    if apollo_id:
        return f"id:{apollo_id}"
    linkedin = (record.get("linkedin_url") or "").strip().lower()
    if linkedin:
        return f"li:{linkedin}"
    domain = (record.get("company_domain") or "").strip().lower()
    name = (record.get("name") or "").strip().lower()
    return f"nd:{domain}:{name}"


def filter_new(records: list) -> list:
    conn = _connect()
    cur = conn.cursor()
    new_records = []
    for r in records:
        key = make_key(r)
        cur.execute("SELECT 1 FROM seen_leads WHERE dedupe_key = ?", (key,))
        if cur.fetchone() is None:
            new_records.append(r)
    conn.close()
    return new_records


def mark_seen(records: list):
    conn = _connect()
    cur = conn.cursor()
    now = datetime.datetime.utcnow().isoformat()
    for r in records:
        key = make_key(r)
        cur.execute(
            "INSERT OR IGNORE INTO seen_leads (dedupe_key, email, linkedin_url, first_seen) VALUES (?, ?, ?, ?)",
            (key, r.get("email"), r.get("linkedin_url"), now),
        )
    conn.commit()
    conn.close()

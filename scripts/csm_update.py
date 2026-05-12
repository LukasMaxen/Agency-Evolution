"""
CSM Update Script
Fetches emails sent, replies, interested from DB and meetings from Airtable.
Writes all numbers into the Google Sheet (one-time OAuth on first run).

Sheet: https://docs.google.com/spreadsheets/d/1WzGegfSJvxnp1ZYxQfACmN-tLM3SZ6EQ4PIUhtfXeic

Columns written (by header name):
  Emails Sent Last 24h / Last 7 Days / Last 30 Days
  Replies Last 24h / Last 7 Days / Last 30 Days
  Interested Last 24h / Last 7 Days / Last 30 Days
  Meetings Booked Last 24 hours / Last 7 Days / Last 30 Days

Run:  python3 scripts/csm_update.py
First run will open a browser for Google OAuth.
"""

import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
import warnings

warnings.filterwarnings("ignore")

# ── credentials ──────────────────────────────────────────────────────────────
DB = os.environ.get(
    "DATABASE_URL",
    "postgresql://aird:QWEdsa123@77.42.71.101:5433/ai_reply_desk",
)
AIRTABLE_KEY = os.environ.get(
    "AIRTABLE_API_KEY",
    "patyMfD6S2jbaPLVE.aaf36c656defbcb0990432e28eff2f587b84c36d61073f00538151e0c51a67d5",
)
SHEET_ID = "1WzGegfSJvxnp1ZYxQfACmN-tLM3SZ6EQ4PIUhtfXeic"

# ── client config ─────────────────────────────────────────────────────────────
# Maps sheet row "Client Name" -> workspace_slug in DB
SLUG_MAP = {
    "911 Restoration":    "911-restoration",
    "ACT Capital":        "act-capital",
    "Acceler8rs":         "acceler8rs",
    "GN Motion":          "gn-motion",
    "Hahnbeck":           "hahnbeck",
    "ITG Group":          "itg-group",
    "Internal Campaigns": "internal-campaigns",
    "Larsen Digital":     "larsen-digital",
    "Micro Nordic":       "micro-nordic",
    "Sonaro AI":          "sonaro-ai",
    "Statera Capital":    "statera-capital",
    "Venture Exits":      "venture-exits",
    "Wrobel Capital":     "wrobel-capital",
    "Zebs IBS":           "zebs-ibs",
}

# Maps workspace_slug -> (airtable_base_id, table_id, meeting_date_field)
AIRTABLE_MEETINGS = {
    "911-restoration":    ("appGTy1rR6eZjKu62", "tblVEhq27whUNk4KY", "Meeting booked date"),
    "acceler8rs":         ("appV8wpBdqTgCi4Ws", "tblCATnaPTV9fb2Ab", "Meeting booked date"),
    "act-capital":        ("appECObQrdSRjeXeM", "tblTnxArHDVMNOxSI", "Meeting Booked Date"),
    "gn-motion":          ("appL5fZEyULdqpyx5", "tblTnxArHDVMNOxSI", "Meeting Booked Date"),
    "hahnbeck":           ("appUZr45I0MK7uv3w", "tbl9KatGYqPFB45Hs", "Meeting booked date"),
    "internal-campaigns": ("app9rWZ2iE4eWECEN", "tblCATnaPTV9fb2Ab", "Meeting booked date"),
    "itg-group":          ("appajhv22WuCEw7Aa", "tblTnxArHDVMNOxSI", "Meeting Booked Date"),
    "larsen-digital":     ("appmixoDAnp7FicCS", "tblB3gNeQNs29SMgO", "Meeting booked date"),
    "micro-nordic":       ("appBH1m8XsGoRmSPZ", "tblVEhq27whUNk4KY", "Meeting booked date"),
    "sonaro-ai":          ("appNMGCTwXVOLLzmA", "tblTnxArHDVMNOxSI", "Meeting Booked Date"),
    "statera-capital":    ("app0EI3nqT3ScUJOf", "tblTnxArHDVMNOxSI", "Meeting Booked Date"),
    "venture-exits":      ("appA3W783M4v9IShx", "tblTnxArHDVMNOxSI", "Meeting Booked Date"),
    "wrobel-capital":     ("appFvPc98WyrPibkV", "tblTnxArHDVMNOxSI", "Meeting Booked Date"),
    "zebs-ibs":           ("appdpPuzEjTqFSOi2", "tblTnxArHDVMNOxSI", "Meeting Booked Date"),
}

# ── DB helpers ────────────────────────────────────────────────────────────────
def db_query(sql):
    r = subprocess.run(
        ["psql", DB, "-t", "-A", "-F", "|", "-c", sql],
        capture_output=True, text=True,
    )
    out = {}
    for line in r.stdout.strip().split("\n"):
        if "|" in line:
            parts = line.split("|")
            out[parts[0]] = parts[1:]
    return out


def fetch_sent():
    return db_query(
        "SELECT workspace_slug,"
        " COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '1 day'),"
        " COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '7 days'),"
        " COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '30 days')"
        " FROM emails_sent WHERE sequence_step IS NOT NULL"
        " GROUP BY workspace_slug"
    )


def fetch_replies():
    # Use AI intent as source of truth for interested — the boolean `interested`
    # column is not reliably populated. Interested = intent in
    # (interested, interested_urgent, needs_info) OR the boolean flag is true.
    interested_filter = (
        "(interested = true OR ai_analysis->>'intent' IN "
        "('interested','interested_urgent','needs_info'))"
    )
    return db_query(
        "SELECT workspace_slug,"
        " COUNT(DISTINCT lead_email) FILTER (WHERE received_at >= NOW() - INTERVAL '1 day'),"
        f" COUNT(DISTINCT lead_email) FILTER (WHERE {interested_filter} AND received_at >= NOW() - INTERVAL '1 day'),"
        " COUNT(DISTINCT lead_email) FILTER (WHERE received_at >= NOW() - INTERVAL '7 days'),"
        f" COUNT(DISTINCT lead_email) FILTER (WHERE {interested_filter} AND received_at >= NOW() - INTERVAL '7 days'),"
        " COUNT(DISTINCT lead_email) FILTER (WHERE received_at >= NOW() - INTERVAL '30 days'),"
        f" COUNT(DISTINCT lead_email) FILTER (WHERE {interested_filter} AND received_at >= NOW() - INTERVAL '30 days')"
        " FROM replies GROUP BY workspace_slug"
    )


# ── Airtable helpers ──────────────────────────────────────────────────────────
def airtable_count(base_id, table_id, field, days):
    if days == 1:
        formula = f"IS_SAME({{{field}}}, TODAY(), 'day')"
    else:
        formula = (
            f"AND("
            f"IS_AFTER({{{field}}}, DATEADD(TODAY(), -{days}, 'day')), "
            f"IS_BEFORE({{{field}}}, DATEADD(TODAY(), 1, 'day'))"
            f")"
        )
    url = (
        f"https://api.airtable.com/v0/{base_id}/{table_id}"
        f"?filterByFormula={urllib.parse.quote(formula)}"
        f"&fields[]={urllib.parse.quote(field)}"
    )
    total = 0
    offset = None
    while True:
        page_url = url + (f"&offset={offset}" if offset else "")
        req = urllib.request.Request(
            page_url, headers={"Authorization": f"Bearer {AIRTABLE_KEY}"}
        )
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read())
                total += len(data.get("records", []))
                offset = data.get("offset")
                if not offset:
                    break
        except Exception as e:
            print(f"  Airtable error ({base_id}): {e}", file=sys.stderr)
            break
    return total


def fetch_meetings(days=1):
    """Fetch meeting counts from Airtable for the given number of days back.
    Airtable is the sole source of truth for meetings — never use the DB."""
    result = {}
    for slug, (base_id, table_id, field) in AIRTABLE_MEETINGS.items():
        result[slug] = airtable_count(base_id, table_id, field, days)
        print(f"  {slug}: {result[slug]}")
    return result


# ── Google Sheets helpers ─────────────────────────────────────────────────────
def get_sheet():
    import gspread
    # gspread.oauth() opens a browser on first run and caches the token at
    # ~/.config/gspread/authorized_user.json for all subsequent runs.
    gc = gspread.oauth()
    return gc.open_by_key(SHEET_ID).sheet1


def find_col(headers, name):
    """Return 0-based column index for the given header name (case-insensitive)."""
    for i, h in enumerate(headers):
        if h.strip().lower() == name.strip().lower():
            return i
    return None


def update_sheet(sent, replies, meetings):
    print("\nConnecting to Google Sheet...")
    ws = get_sheet()
    all_values = ws.get_all_values()
    if not all_values:
        print("Sheet is empty.", file=sys.stderr)
        return

    headers = all_values[0]

    # Column name -> 0-based index mapping (add columns if missing)
    WANTED_COLS = [
        "Emails Sent Last 24h",
        "Emails Sent Last 7 Days",
        "Emails Sent Last 30 Days",
        "Replies Last 24h",
        "Replies Last 7 Days",
        "Replies Last 30 Days",
        "Interested Last 24h",
        "Interested Last 7 Days",
        "Interested Last 30 Days",
        "Meetings Booked Last 24 hours",
        "Meetings Booked Last 7 Days",
        "Meetings Booked Last 30 Days",
    ]

    col_idx = {}
    for col_name in WANTED_COLS:
        idx = find_col(headers, col_name)
        if idx is None:
            # Append new column header
            idx = len(headers)
            headers.append(col_name)
            ws.update_cell(1, idx + 1, col_name)
            print(f"  Added column: {col_name}")
        col_idx[col_name] = idx

    # Find "Client Name" column
    client_col = find_col(headers, "Client Name")
    if client_col is None:
        print("ERROR: Could not find 'Client Name' column.", file=sys.stderr)
        return

    updates = []
    for row_i, row in enumerate(all_values[1:], start=2):
        client_name = row[client_col].strip() if client_col < len(row) else ""
        slug = SLUG_MAP.get(client_name)
        if not slug:
            continue

        s = sent.get(slug, ["0", "0", "0"])
        r = replies.get(slug, ["0", "0", "0", "0", "0", "0"])
        m = meetings.get(slug, {"24h": 0, "7d": 0, "30d": 0})

        values = {
            "Emails Sent Last 24h":        s[0],
            "Emails Sent Last 7 Days":     s[1],
            "Emails Sent Last 30 Days":    s[2],
            "Replies Last 24h":            r[0],
            "Replies Last 7 Days":         r[2],
            "Replies Last 30 Days":        r[4],
            "Interested Last 24h":         r[1],
            "Interested Last 7 Days":      r[3],
            "Interested Last 30 Days":     r[5],
            "Meetings Booked Last 24 hours": m["24h"],
            "Meetings Booked Last 7 Days": m["7d"],
            "Meetings Booked Last 30 Days": m["30d"],
        }

        for col_name, val in values.items():
            col_1based = col_idx[col_name] + 1
            updates.append({"range": f"R{row_i}C{col_1based}", "values": [[val]]})

    if updates:
        ws.spreadsheet.values_batch_update(
            {"valueInputOption": "RAW", "data": [
                {"range": u["range"], "values": u["values"]} for u in updates
            ]}
        )
        print(f"  Updated {len(updates)} cells across {len(all_values)-1} client rows.")
    else:
        print("  Nothing to update.")


# ── main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Fetching emails sent from DB...")
    sent = fetch_sent()
    print(f"  {len(sent)} workspaces found.")

    print("Fetching replies + interested from DB...")
    replies = fetch_replies()
    print(f"  {len(replies)} workspaces found.")

    print("Fetching meetings from Airtable...")
    meetings = fetch_meetings()

    update_sheet(sent, replies, meetings)
    print("\nDone.")

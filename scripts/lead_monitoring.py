#!/usr/bin/env python3
"""
Lead Monitoring Report
Runs daily at 9am CET. Posts two Slack messages:
  1. Daily lead supply (Task 1: remaining < 80% of daily capacity)
  2. 3-week runway (Task 2: remaining < max_new_leads_per_day x 5)
"""

import urllib.request
import json
import subprocess
from datetime import date
from collections import defaultdict

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DB_URL = "postgresql://aird:QWEdsa123@77.42.71.101:5433/ai_reply_desk"
SLACK_TOKEN = "xoxb-5094014227030-11028184509637-q5B8xeOO4Wv19671uvAeri6i"
SLACK_CHANNEL = "C0B268H8Z2S"
TESTING_STAGE_MIN = 700
TESTING_STAGE_MAX = 1400


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def eb_get(url, api_key):
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  ERROR fetching {url}: {e}")
        return {}


def slack_post(text):
    payload = json.dumps({"channel": SLACK_CHANNEL, "text": text}).encode()
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=payload,
        headers={
            "Authorization": f"Bearer {SLACK_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        result = json.loads(r.read())
        if not result.get("ok"):
            print(f"  Slack error: {result.get('error')}")
        return result


def client_label(slug):
    return slug.upper().replace("-", " ")


def build_grouped_message(flags, header_line, bullet_fn, follow_up_zeros, total_active, total_workspaces):
    if not flags and not follow_up_zeros:
        return header_line.replace("🔴", "🟢").replace("🟠", "🟢").split("\n")[0] + "\nAll campaigns healthy."

    # Group by workspace
    by_ws = defaultdict(list)
    for f in flags:
        by_ws[f["workspace"]].append(f)

    # Sort workspaces by total deficit descending
    ws_order = sorted(by_ws.keys(), key=lambda w: sum(x["deficit"] for x in by_ws[w]), reverse=True)

    lines = [header_line, ""]

    for ws in ws_order:
        items = sorted(by_ws[ws], key=lambda x: x["deficit"], reverse=True)
        label = client_label(ws)
        count = len(items)
        all_critical = all(x["remaining"] <= 0 for x in items)
        suffix = ", all critical" if all_critical and count > 1 else ""
        lines.append(f"*{label}* — {count} campaign{'s' if count != 1 else ''}{suffix}")
        for item in items:
            lines.append(bullet_fn(item))
        lines.append("")

    if follow_up_zeros > 0:
        lines.append(f"_{follow_up_zeros} Follow Up queue{'s' if follow_up_zeros != 1 else ''} are also at 0._")
        lines.append("")

    lines.append(f"_{total_active} campaigns checked across {total_workspaces} workspaces_")
    return "\n".join(lines).strip()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    today = date.today().strftime("%B %-d, %Y")

    # 1. Get workspaces from DB
    result = subprocess.run(
        ["psql", DB_URL, "-t", "-A", "-F\t",
         "-c", "SELECT slug, email_bison_api_key, email_bison_instance_url FROM workspaces"],
        capture_output=True, text=True
    )
    workspaces = []
    for line in result.stdout.strip().splitlines():
        parts = line.strip().split("\t")
        if len(parts) == 3:
            workspaces.append(tuple(parts))

    print(f"Loaded {len(workspaces)} workspaces")

    task1_flags = []
    task2_flags = []
    follow_up_zeros = 0
    total_active = 0

    for slug, api_key, instance_url in workspaces:
        data = eb_get(f"{instance_url}/api/campaigns", api_key)
        campaigns = data.get("data", [])
        active = [c for c in campaigns if c.get("status") == "active"]

        for c in active:
            name = c.get("name", "")

            # Count Follow Ups at 0 separately
            if name == "Follow Ups":
                total_leads = c.get("total_leads") or 0
                contacted = c.get("total_leads_contacted") or 0
                remaining = total_leads - contacted
                if remaining <= 0:
                    follow_up_zeros += 1
                continue

            total_active += 1
            cid = c["id"]
            total_leads = c.get("total_leads") or 0
            contacted = c.get("total_leads_contacted") or 0
            remaining = total_leads - contacted
            max_new = c.get("max_new_leads_per_day") or 0

            # Get sender capacity
            senders_data = eb_get(f"{instance_url}/api/campaigns/{cid}/sender-emails", api_key)
            senders = senders_data.get("data", [])
            max_daily_capacity = sum(s.get("daily_limit", 25) for s in senders) if senders else max_new

            # Task 1
            threshold = max_daily_capacity * 0.8
            if remaining < threshold:
                task1_flags.append({
                    "workspace": slug,
                    "campaign": name,
                    "remaining": remaining,
                    "deficit": int(threshold - remaining),
                })

            # Task 2 (skip testing stage)
            if not (TESTING_STAGE_MIN <= remaining <= TESTING_STAGE_MAX):
                required = max_new * 5
                if remaining < required:
                    task2_flags.append({
                        "workspace": slug,
                        "campaign": name,
                        "remaining": remaining,
                        "required": required,
                        "deficit": int(required - remaining),
                    })

    print(f"Active campaigns: {total_active}, Task1 flags: {len(task1_flags)}, Task2 flags: {len(task2_flags)}, Follow Up zeros: {follow_up_zeros}")

    # Build Message 1
    def bullet_t1(item):
        r = item["remaining"]
        d = item["deficit"]
        name = item["campaign"]
        if r < 0:
            return f"  • {name} — `{r}` ⚠️ (deficit: {d:,})"
        elif r == 0:
            return f"  • {name} — `0` (deficit: {d:,})"
        else:
            return f"  • {name} — `{r}` left (deficit: {d:,})"

    t1_count = len(task1_flags)
    t1_header = f"\U0001f534 *Daily lead supply* — {today}\n{t1_count} of {total_active} campaigns flagged (below 80% capacity)"
    msg1 = build_grouped_message(task1_flags, t1_header, bullet_t1, follow_up_zeros, total_active, len(workspaces))

    # Build Message 2
    def bullet_t2(item):
        r = item["remaining"]
        req = item["required"]
        d = item["deficit"]
        name = item["campaign"]
        return f"  • {name} — `{r}` / {req:,} needed (deficit: {d:,})"

    t2_count = len(task2_flags)
    t2_header = f"\U0001f7e0 *3-Week runway* — {today}\n{t2_count} of {total_active} campaigns flagged (below 3-week supply)"
    msg2 = build_grouped_message(task2_flags, t2_header, bullet_t2, 0, total_active, len(workspaces))

    print("\n--- Message 1 ---")
    print(msg1)
    print("\n--- Message 2 ---")
    print(msg2)

    slack_post(msg1)
    slack_post(msg2)
    print("\nDone.")


if __name__ == "__main__":
    main()

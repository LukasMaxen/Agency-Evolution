#!/usr/bin/env python3
"""
Lead Monitoring Report
Runs daily at 9am CET. Posts one Slack message flagging campaigns
where remaining leads are below 80% of daily sending capacity.
If nothing is flagged, posts a short all-clear.
"""

import urllib.request
import json
import subprocess
from datetime import date
from collections import defaultdict

DB_URL = "postgresql://aird:QWEdsa123@77.42.71.101:5433/ai_reply_desk"
SLACK_TOKEN = "xoxb-5094014227030-11028184509637-q5B8xeOO4Wv19671uvAeri6i"
SLACK_CHANNEL = "C0B268H8Z2S"


def eb_get(url, api_key):
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  ERROR {url}: {e}")
        return {}


def slack_post(text):
    payload = json.dumps({"channel": SLACK_CHANNEL, "text": text}).encode()
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=payload,
        headers={"Authorization": f"Bearer {SLACK_TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        result = json.loads(r.read())
        if not result.get("ok"):
            print(f"  Slack error: {result.get('error')}")


def main():
    today = date.today().strftime("%B %-d, %Y")

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

    flags = []
    follow_up_zeros = 0
    total_active = 0

    for slug, api_key, instance_url in workspaces:
        data = eb_get(f"{instance_url}/api/campaigns", api_key)
        for c in data.get("data", []):
            if c.get("status") != "active":
                continue

            name = c.get("name", "")
            total_leads = c.get("total_leads") or 0
            contacted = c.get("total_leads_contacted") or 0
            remaining = total_leads - contacted

            if name == "Follow Ups":
                if remaining <= 0:
                    follow_up_zeros += 1
                continue

            total_active += 1
            cid = c["id"]

            senders_data = eb_get(f"{instance_url}/api/campaigns/{cid}/sender-emails", api_key)
            senders = senders_data.get("data", [])
            max_daily = sum(s.get("daily_limit", 25) for s in senders) if senders else (c.get("max_new_leads_per_day") or 0)

            if remaining < max_daily * 0.8:
                flags.append({
                    "workspace": slug,
                    "campaign": name,
                    "remaining": remaining,
                    "deficit": int(max_daily * 0.8 - remaining),
                })

    print(f"Active: {total_active}, Flagged: {len(flags)}, Follow Up zeros: {follow_up_zeros}")

    if not flags and not follow_up_zeros:
        msg = f"\U0001f7e2 *Lead supply* — {today}\nAll clear. No campaigns below 80% capacity."
    else:
        by_ws = defaultdict(list)
        for f in flags:
            by_ws[f["workspace"]].append(f)

        ws_order = sorted(by_ws.keys(), key=lambda w: sum(x["deficit"] for x in by_ws[w]), reverse=True)

        count = len(flags)
        lines = [f"\U0001f534 *Lead supply* — {today}", f"{count} campaign{'s' if count != 1 else ''} below 80% capacity", ""]

        for ws in ws_order:
            items = sorted(by_ws[ws], key=lambda x: x["deficit"], reverse=True)
            label = ws.upper().replace("-", " ")
            lines.append(f"*{label}*")
            for item in items:
                r = item["remaining"]
                d = item["deficit"]
                n = item["campaign"]
                if r < 0:
                    bullet = f"  • {n} — `{r}` ⚠️ (need {d:,} more)"
                elif r == 0:
                    bullet = f"  • {n} — empty (need {d:,})"
                else:
                    bullet = f"  • {n} — `{r}` left (need {d:,} more)"
                lines.append(bullet)
            lines.append("")

        if follow_up_zeros:
            lines.append(f"_{follow_up_zeros} Follow Up queue{'s' if follow_up_zeros != 1 else ''} also empty_")

        msg = "\n".join(lines).strip()

    print("\n" + msg)
    slack_post(msg)
    print("\nDone.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Lead Monitoring Report
Runs daily at 9am CET. Posts one Slack message flagging campaigns
where remaining leads are below 80% of daily sending capacity.
Checks replies on yesterday's report and adds a POA section for
campaigns that are still flagged after a team member commented.
"""

import urllib.request
import json
import subprocess
from datetime import date, datetime, timezone
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


def slack_api(endpoint, params=None, payload=None):
    if payload:
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"https://slack.com/api/{endpoint}",
            data=data,
            headers={"Authorization": f"Bearer {SLACK_TOKEN}", "Content-Type": "application/json"},
        )
    else:
        qs = "&".join(f"{k}={v}" for k, v in (params or {}).items())
        req = urllib.request.Request(
            f"https://slack.com/api/{endpoint}?{qs}",
            headers={"Authorization": f"Bearer {SLACK_TOKEN}"},
        )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def slack_post(text):
    result = slack_api("chat.postMessage", payload={"channel": SLACK_CHANNEL, "text": text})
    if not result.get("ok"):
        print(f"  Slack error: {result.get('error')}")
    return result.get("ts")


def db_query(sql):
    result = subprocess.run(
        ["psql", DB_URL, "-t", "-A", "-F\t", "-c", sql],
        capture_output=True, text=True
    )
    return result.stdout.strip()


def get_previous_report_ts():
    """Fetch the ts of the most recently stored report from DB."""
    row = db_query("SELECT slack_ts FROM lead_monitoring_log ORDER BY posted_at DESC LIMIT 1")
    return row.strip() if row else None


def save_report_ts(ts):
    db_query(f"INSERT INTO lead_monitoring_log (slack_ts, channel) VALUES ('{ts}', '{SLACK_CHANNEL}')")


def get_thread_replies(ts):
    """Return all non-bot replies on a message thread."""
    # Get our bot user id
    auth = slack_api("auth.test")
    bot_id = auth.get("user_id", "")

    result = slack_api("conversations.replies", params={"channel": SLACK_CHANNEL, "ts": ts})
    messages = result.get("messages", [])
    # Skip the first message (the report itself) and any bot messages
    return [m for m in messages[1:] if m.get("user") != bot_id]


def comments_for_campaign(campaign_name, replies):
    """Return any reply texts that mention this campaign (fuzzy word match)."""
    name_lower = campaign_name.lower()
    # Use significant words from the campaign name (skip short/common words)
    stop = {"the", "a", "an", "of", "for", "and", "in", "on", "to", "is", "are", "at", "by"}
    keywords = [w for w in name_lower.split() if len(w) > 3 and w not in stop]

    matched = []
    for reply in replies:
        text = reply.get("text", "").lower()
        if any(kw in text for kw in keywords):
            matched.append(reply.get("text", ""))
    return matched


def main():
    today = date.today().strftime("%B %-d, %Y")

    # --- Load previous report replies ---
    previous_ts = get_previous_report_ts()
    replies = []
    if previous_ts:
        print(f"Fetching replies on previous report ts={previous_ts}")
        replies = get_thread_replies(previous_ts)
        print(f"Found {len(replies)} replies")
    else:
        print("No previous report found, skipping reply check")

    # --- Load workspaces ---
    raw = db_query("SELECT slug, email_bison_api_key, email_bison_instance_url FROM workspaces")
    workspaces = []
    for line in raw.splitlines():
        parts = line.strip().split("\t")
        if len(parts) == 3:
            workspaces.append(tuple(parts))
    print(f"Loaded {len(workspaces)} workspaces")

    # --- Check campaigns ---
    flags = []
    total_active = 0

    for slug, api_key, instance_url in workspaces:
        data = eb_get(f"{instance_url}/api/campaigns", api_key)
        for c in data.get("data", []):
            if c.get("status") != "active":
                continue

            name = c.get("name", "")
            name_lower = name.lower()
            if "follow" in name_lower or "spam" in name_lower:
                continue

            total_leads = c.get("total_leads") or 0
            contacted = c.get("total_leads_contacted") or 0
            remaining = total_leads - contacted
            max_new = c.get("max_new_leads_per_day") or 0
            total_active += 1


            threshold = max_new * 0.8
            in_followup_mode = remaining <= 0 and contacted > 0
            if remaining < threshold and not in_followup_mode:
                flags.append({
                    "workspace": slug,
                    "campaign": name,
                    "remaining": remaining,
                    "deficit": int(threshold - remaining),
                    "comments": comments_for_campaign(name, replies),
                })

    print(f"Active: {total_active}, Flagged: {len(flags)}")

    # --- Build message ---
    if not flags:
        msg = f"\U0001f7e2 *Lead supply* — {today}\nAll clear."
    else:
        by_ws = defaultdict(list)
        for f in flags:
            by_ws[f["workspace"]].append(f)
        ws_order = sorted(by_ws.keys(), key=lambda w: sum(x["deficit"] for x in by_ws[w]), reverse=True)

        count = len(flags)
        lines = [f"\U0001f534 *Lead supply* — {today}", f"{count} campaign{'s' if count != 1 else ''} below 80% capacity", ""]

        for ws in ws_order:
            items = sorted(by_ws[ws], key=lambda x: x["deficit"], reverse=True)
            lines.append(f"*{ws.upper().replace('-', ' ')}*")
            for item in items:
                r, d, n = item["remaining"], item["deficit"], item["campaign"]
                if r < 0:
                    lines.append(f"  • {n} — `{r}` ⚠️ (need {d:,} more)")
                elif r == 0:
                    lines.append(f"  • {n} — empty (need {d:,})")
                else:
                    lines.append(f"  • {n} — `{r}` left (need {d:,} more)")
            lines.append("")

        # POA section: flagged campaigns that had a comment on yesterday's report
        poa_items = [f for f in flags if f["comments"]]
        if poa_items:
            lines.append("*Needs handling*")
            for item in poa_items:
                for comment in item["comments"]:
                    lines.append(f"  • {item['campaign']} — _{comment}_")
            lines.append("")

        msg = "\n".join(lines).strip()

    print("\n" + msg)
    ts = slack_post(msg)
    if ts:
        save_report_ts(ts)
        print(f"Saved ts={ts}")
    print("\nDone.")


if __name__ == "__main__":
    main()

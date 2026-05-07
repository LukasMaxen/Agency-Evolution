#!/usr/bin/env python3
"""
Lead Monitoring Report
Runs daily at 9am CET. Checks the EmailBison sending schedule for tomorrow
and day after tomorrow per workspace. Flags campaigns where scheduled volume
is below 80% of their daily sending limit. Posts to Slack.
"""

import urllib.request
import json
import re
import subprocess
from datetime import date, timedelta
from collections import defaultdict

DB_URL = "postgresql://aird:QWEdsa123@77.42.71.101:5433/ai_reply_desk"
SLACK_TOKEN = "xoxb-5094014227030-11028184509637-q5B8xeOO4Wv19671uvAeri6i"
SLACK_CHANNEL = "C0B268H8Z2S"
BASE_URL = "https://send.emailagencyevolution.com"


def db_query(sql):
    result = subprocess.run(
        ["psql", DB_URL, "-t", "-A", "-F\t", "-c", sql],
        capture_output=True, text=True
    )
    return result.stdout.strip()


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
        return result.get("ts")


def get_campaign_max_new(api_key):
    """Return (max_new_map, completion_map) for active campaigns."""
    req = urllib.request.Request(
        f"{BASE_URL}/api/campaigns",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    )
    try:
        data = json.loads(urllib.request.urlopen(req, timeout=15).read())
        max_new_map = {}
        completion_map = {}
        for c in data.get("data", []):
            if c.get("status") == "active":
                name = c.get("name", "")
                name_lower = name.lower()
                if "follow" in name_lower or "spam" in name_lower:
                    continue
                max_new_map[name] = c.get("max_new_leads_per_day") or 0
                completion_map[name] = round(c.get("completion_percentage") or 0, 1)
        return max_new_map, completion_map
    except Exception as e:
        print(f"  ERROR fetching campaigns: {e}")
        return {}, {}


def get_schedule_counts(api_key, schedule_type):
    """
    Fetch the EmailBison sending schedule for the given schedule_type
    ('Tomorrow' or 'Day After Tomorrow') and return dict of
    campaign_name -> scheduled_count.
    """
    # Step 1: load page to get Livewire snapshot + CSRF + cookies
    req = urllib.request.Request(
        f"{BASE_URL}/campaigns/sending-schedule",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "text/html", "User-Agent": "Mozilla/5.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode("utf-8", errors="ignore")
            set_cookie = r.headers.get_all("Set-Cookie") or []
    except Exception as e:
        print(f"  ERROR loading schedule page: {e}")
        return {}

    snapshots = re.findall(r'wire:snapshot="([^"]+)"', html)
    schedule_snap = None
    for s in snapshots:
        decoded = s.replace("&quot;", '"')
        try:
            d = json.loads(decoded)
            if d.get("memo", {}).get("name") == "campaign.show-all-scheduled-campaigns":
                schedule_snap = d
                break
        except:
            pass

    if not schedule_snap:
        print("  ERROR: could not find schedule Livewire component")
        return {}

    csrf_match = re.search(r'<meta name="csrf-token" content="([^"]+)"', html)
    csrf_token = csrf_match.group(1) if csrf_match else ""
    cookie_str = "; ".join(c.split(";")[0] for c in set_cookie)

    # Step 2: Livewire update to switch date
    payload = json.dumps({
        "components": [{
            "snapshot": json.dumps(schedule_snap),
            "updates": {"schedule_type": schedule_type},
            "calls": []
        }]
    }).encode()

    req2 = urllib.request.Request(
        f"{BASE_URL}/livewire/update",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Livewire": "true",
            "X-CSRF-TOKEN": csrf_token,
            "User-Agent": "Mozilla/5.0",
            "Referer": f"{BASE_URL}/campaigns/sending-schedule",
            "Cookie": cookie_str,
        }
    )
    try:
        with urllib.request.urlopen(req2, timeout=15) as r:
            resp = json.loads(r.read().decode())
    except Exception as e:
        print(f"  ERROR Livewire call: {e}")
        return {}

    sched_html = resp.get("components", [{}])[0].get("effects", {}).get("html", "")

    # Step 3: parse campaign names + scheduled counts from table rows
    # Pattern: x-tooltip.raw="CAMPAIGN NAME" ... <p ...>COUNT</p>
    counts = {}
    rows = re.findall(
        r'x-tooltip\.raw="([^"]+)".*?<p[^>]*data-flux-text[^>]*>\s*(\d+)\s*</p>',
        sched_html, re.DOTALL
    )
    for name, count in rows:
        counts[name] = int(count)

    return counts


def get_previous_report_ts():
    row = db_query("SELECT slack_ts FROM lead_monitoring_log ORDER BY posted_at DESC LIMIT 1")
    return row.strip() if row else None


def save_report_ts(ts):
    db_query(f"INSERT INTO lead_monitoring_log (slack_ts, channel) VALUES ('{ts}', '{SLACK_CHANNEL}')")


def get_thread_replies(ts):
    auth = json.loads(urllib.request.urlopen(
        urllib.request.Request("https://slack.com/api/auth.test",
            headers={"Authorization": f"Bearer {SLACK_TOKEN}"})
    ).read())
    bot_id = auth.get("user_id", "")
    result = json.loads(urllib.request.urlopen(
        urllib.request.Request(
            f"https://slack.com/api/conversations.replies?channel={SLACK_CHANNEL}&ts={ts}",
            headers={"Authorization": f"Bearer {SLACK_TOKEN}"})
    ).read())
    return [m for m in result.get("messages", [])[1:] if m.get("user") != bot_id]


def comments_for_campaign(campaign_name, replies):
    name_lower = campaign_name.lower()
    stop = {"the", "a", "an", "of", "for", "and", "in", "on", "to", "is", "are", "at", "by"}
    keywords = [w for w in name_lower.split() if len(w) > 3 and w not in stop]
    return [r.get("text", "") for r in replies if any(kw in r.get("text", "").lower() for kw in keywords)]


def main():
    today = date.today().strftime("%B %-d, %Y")

    # Load previous report replies
    previous_ts = get_previous_report_ts()
    replies = []
    if previous_ts:
        print(f"Fetching replies on ts={previous_ts}")
        try:
            replies = get_thread_replies(previous_ts)
            print(f"Found {len(replies)} replies")
        except Exception as e:
            print(f"Could not fetch replies: {e}")

    # Load workspace credentials
    raw = db_query("SELECT slug, email_bison_api_key, email_bison_instance_url FROM workspaces")
    workspaces = [tuple(l.split("\t")) for l in raw.splitlines() if len(l.split("\t")) == 3]
    print(f"Loaded {len(workspaces)} workspaces")

    flags = []

    for slug, api_key, instance_url in workspaces:
        print(f"Checking {slug}...")

        # Get max_new_leads_per_day per active campaign
        max_new_map, completion_map = get_campaign_max_new(api_key)
        if not max_new_map:
            continue

        # Get scheduled counts for tomorrow and day after tomorrow
        counts_tmrw = get_schedule_counts(api_key, "Tomorrow")
        counts_dat = get_schedule_counts(api_key, "Day After Tomorrow")

        # Merge: take the lower of the two days as the worst case
        all_campaigns = set(max_new_map.keys()) | set(counts_tmrw.keys()) | set(counts_dat.keys())

        for name in all_campaigns:
            name_lower = name.lower()
            if "follow" in name_lower or "spam" in name_lower:
                continue
            if name not in max_new_map:
                continue  # not an active campaign we're tracking

            max_new = max_new_map[name]
            if max_new == 0:
                continue

            threshold = max_new * 0.8
            tmrw = counts_tmrw.get(name, 0)
            dat = counts_dat.get(name, 0)

            # Only check sending days (Mon-Fri). Skip weekend days.
            tomorrow_date = date.today() + timedelta(days=1)
            dat_date = date.today() + timedelta(days=2)
            tmrw_is_sending = tomorrow_date.weekday() < 5
            dat_is_sending = dat_date.weekday() < 5

            appears_in_schedule = tmrw > 0 or dat > 0
            completion = completion_map.get(name, 0)
            note = None
            flagged = False

            if appears_in_schedule:
                # In schedule but below threshold on a sending day
                if tmrw_is_sending and tmrw < threshold:
                    flagged = True
                if dat_is_sending and dat < threshold:
                    flagged = True
            elif completion >= 90:
                # Not in schedule because it's nearly done — needs new leads
                flagged = True
                note = f"{completion}% complete"

            if flagged:
                flags.append({
                    "workspace": slug,
                    "campaign": name,
                    "scheduled_tmrw": tmrw,
                    "scheduled_dat": dat,
                    "threshold": int(threshold),
                    "deficit": int(threshold - min(
                        tmrw if tmrw_is_sending else threshold,
                        dat if dat_is_sending else threshold
                    )),
                    "note": note,
                    "comments": comments_for_campaign(name, replies),
                })

    print(f"Flagged: {len(flags)}")

    # Build Slack message
    if not flags:
        msg = f"\U0001f7e2 *Lead supply* — {today}\nAll clear. No campaigns below 80% capacity."
    else:
        by_ws = defaultdict(list)
        for f in flags:
            by_ws[f["workspace"]].append(f)
        ws_order = sorted(by_ws.keys(), key=lambda w: sum(x["deficit"] for x in by_ws[w]), reverse=True)

        count = len(flags)
        lines = [
            f"\U0001f534 *Lead supply* — {today}",
            f"{count} campaign{'s' if count != 1 else ''} below 80% of daily limit",
            ""
        ]

        for ws in ws_order:
            items = sorted(by_ws[ws], key=lambda x: x["deficit"], reverse=True)
            lines.append(f"*{ws.upper().replace('-', ' ')}*")
            for item in items:
                t = item["scheduled_tmrw"]
                d = item["scheduled_dat"]
                thr = item["threshold"]
                n = item["campaign"]
                lines.append(f"  • {n} — tmrw: `{t}` / dat: `{d}` (need {thr}+)")
            lines.append("")

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
    print("\nDone.")


if __name__ == "__main__":
    main()

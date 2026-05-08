import json
import urllib.request
import urllib.parse
import subprocess
import datetime
import os
import sys

now_utc = datetime.datetime.now(datetime.timezone.utc)
yesterday = (now_utc - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
next_day = now_utc.strftime("%Y-%m-%d")
date_label = (now_utc - datetime.timedelta(days=1)).strftime("%d %b %Y")

db = os.environ.get("DATABASE_URL", "postgresql://aird:QWEdsa123@77.42.71.101:5433/ai_reply_desk")
slack_token = os.environ.get("SLACK_BOT_TOKEN", "xoxb-5094014227030-11028184509637-q5B8xeOO4Wv19671uvAeri6i")

# Load AIRTABLE_API_KEY from .env.local if not in environment
airtable_key = os.environ.get("AIRTABLE_API_KEY", "")
if not airtable_key:
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.local")
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("AIRTABLE_API_KEY="):
                    airtable_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    except Exception:
        pass

def query(sql):
    r = subprocess.run(["psql", db, "-t", "-A", "-F", "|", "-c", sql], capture_output=True, text=True)
    rows = {}
    for line in r.stdout.strip().split("\n"):
        if "|" in line:
            p = line.split("|")
            rows[p[0]] = p[1:]
    return rows

# Sent: exclude NULL sequence_step (those are manual Deal Team campaigns, not cold sequence emails)
S = {k: int(v[0]) for k, v in query(
    f"SELECT workspace_slug, COUNT(*) FROM emails_sent "
    f"WHERE sent_at >= '{yesterday} 00:00:00' "
    f"AND sent_at < '{next_day} 00:00:00' "
    f"AND sequence_step IS NOT NULL "
    f"GROUP BY workspace_slug"
).items()}

# Replies: count distinct leads (not individual messages), UTC
R = {k: (int(v[0]), int(v[1])) for k, v in query(
    f"SELECT workspace_slug, COUNT(DISTINCT lead_email), COUNT(DISTINCT lead_email) FILTER (WHERE interested = true) FROM replies "
    f"WHERE received_at >= '{yesterday} 00:00:00' "
    f"AND received_at < '{next_day} 00:00:00' "
    f"GROUP BY workspace_slug"
).items()}

# Airtable meetings config: (base_id, table_id, field_name)
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

def airtable_meetings_yesterday(slug):
    if not airtable_key or slug not in AIRTABLE_MEETINGS:
        return 0
    base_id, table_id, field = AIRTABLE_MEETINGS[slug]
    formula = urllib.parse.quote(f"IS_SAME({{{field}}}, '{yesterday}', 'day')")
    url = f"https://api.airtable.com/v0/{base_id}/{table_id}?filterByFormula={formula}&fields[]={urllib.parse.quote(field)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {airtable_key}"})
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            return len(data.get("records", []))
    except Exception as e:
        print(f"Airtable error for {slug}: {e}", file=sys.stderr)
        return 0

# Pull meetings from Airtable for each client
M = {slug: airtable_meetings_yesterday(slug) for slug in AIRTABLE_MEETINGS}

NAMES = {
    "911-restoration": "911 Restoration",
    "acceler8rs": "Acceler8rs",
    "act-capital": "ACT Capital",
    "gn-motion": "GN Motion",
    "hahnbeck": "Hahnbeck",
    "internal-campaigns": "Internal Campaigns",
    "itg-group": "ITG Group",
    "larsen-digital": "Larsen Digital",
    "micro-nordic": "Micro Nordic",
    "sonaro-ai": "Sonaro AI",
    "statera-capital": "Statera Capital",
    "venture-exits": "Venture Exits",
    "wrobel-capital": "Wrobel Capital",
    "zebs-ibs": "Zebs IBS",
}

# Include all known workspaces (internal-campaigns may have 0 sends if webhook not tracked)
all_slugs = set(S.keys()) | set(NAMES.keys())
slugs = sorted(all_slugs, key=lambda s: NAMES.get(s, s))

def cd(v, d=2):
    return f"{v:.{d}f}".replace(".", ",")

def ft(v):
    return f"{v:,}"

lines = [f"*Daily Email Performance - {date_label}*\n"]
ts = tr = ti = tm = 0

for slug in slugs:
    nm = NAMES.get(slug, slug)
    sent = S.get(slug, 0)
    rep, itr = R.get(slug, (0, 0))
    mtg = M.get(slug, 0)

    rr = cd(rep / sent * 100) + "%" if sent else "N/A"
    ss = ft(sent) if sent else "N/A"
    ip = cd(itr / rep * 100) + "%" if rep else "0%"
    mp = cd(mtg / itr * 100) + "%" if itr > 0 else "TBD%"
    e2l = ft(round(sent / itr)) if itr > 0 and sent else "-"
    e2m = ft(round(sent / mtg)) if mtg > 0 and sent else "-"

    if sent:
        ts += sent
    tr += rep
    ti += itr
    tm += mtg

    lines += [
        f"*{nm}:*",
        f"Emails Sent: {ss}",
        f"Total Replies: {rep}",
        f"Reply Rate: {rr}",
        f"Interested Replies: {itr} - {ip}",
        f"Meetings Booked: {mtg} - {mp}",
        "",
        f"Emails to get a Lead: {e2l}",
        f"Emails to get a Meeting: {e2m}",
        "Observation:",
        "________________________________________\n",
    ]

orr = f"{tr/ts*100:.2f}%" if ts else "N/A"
pr = f"{ti/tr*100:.2f}%" if tr else "N/A"
mc = f"{tm/ti*100:.2f}%" if ti else "N/A"
e2lt = ft(round(ts / ti)) if ti else "-"
e2mt = ft(round(ts / tm)) if tm else "-"

lines += [
    "*Total Numbers Yesterday:*\n",
    f"Emails Sent: {ft(ts)}",
    f"Total Replies: {tr}",
    f"Reply Rate %: {orr}",
    f"Positive Replies: {ti}",
    f"Positive Reply Rate %: {pr}",
    f"Meetings: {tm}",
    f"Meeting Conversion %: {mc}",
    "",
    "Efficiency",
    f"Emails sent to get 1 positive reply: {e2lt}",
    f"Emails sent to get 1 meeting: {e2mt}",
]

msg = "\n".join(lines)
payload = json.dumps({"channel": "C092ZPT3T2P", "text": msg}).encode()
req = urllib.request.Request(
    "https://slack.com/api/chat.postMessage",
    data=payload,
    headers={"Authorization": f"Bearer {slack_token}", "Content-Type": "application/json"},
)
with urllib.request.urlopen(req) as resp:
    res = json.loads(resp.read())
    print("ok:", res.get("ok"))
    if not res.get("ok"):
        print("error:", res.get("error"))
        sys.exit(1)

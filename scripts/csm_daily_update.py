import json
import urllib.request
import subprocess
import datetime
import os
import sys

try:
    import pytz
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "pytz", "-q"])
    import pytz

NY = pytz.timezone("America/New_York")
now_ny = datetime.datetime.now(NY)
yesterday = (now_ny - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
next_day = now_ny.strftime("%Y-%m-%d")
date_label = (now_ny - datetime.timedelta(days=1)).strftime("%d %b %Y")

db = os.environ["DATABASE_URL"]
token = os.environ["SLACK_BOT_TOKEN"]

def query(sql):
    r = subprocess.run(["psql", db, "-t", "-A", "-F", "|", "-c", sql], capture_output=True, text=True)
    rows = {}
    for line in r.stdout.strip().split("\n"):
        if "|" in line:
            p = line.split("|")
            rows[p[0]] = p[1:]
    return rows

S = {k: int(v[0]) for k, v in query(
    f"SELECT workspace_slug, COUNT(*) FROM emails_sent "
    f"WHERE sent_at AT TIME ZONE 'America/New_York' >= '{yesterday} 00:00:00' "
    f"AND sent_at AT TIME ZONE 'America/New_York' < '{next_day} 00:00:00' "
    f"GROUP BY workspace_slug"
).items()}

R = {k: (int(v[0]), int(v[1])) for k, v in query(
    f"SELECT workspace_slug, COUNT(*), COUNT(*) FILTER (WHERE interested = true) FROM replies "
    f"WHERE received_at AT TIME ZONE 'America/New_York' >= '{yesterday} 00:00:00' "
    f"AND received_at AT TIME ZONE 'America/New_York' < '{next_day} 00:00:00' "
    f"GROUP BY workspace_slug"
).items()}

M = {k: int(v[0]) for k, v in query(
    f"SELECT workspace_slug, COUNT(*) FROM replies "
    f"WHERE meeting_booked = true "
    f"AND received_at AT TIME ZONE 'America/New_York' >= '{yesterday} 00:00:00' "
    f"AND received_at AT TIME ZONE 'America/New_York' < '{next_day} 00:00:00' "
    f"GROUP BY workspace_slug"
).items()}

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

slugs = sorted(set(list(S.keys()) + list(R.keys())), key=lambda s: NAMES.get(s, s))

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
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
)
with urllib.request.urlopen(req) as resp:
    res = json.loads(resp.read())
    print("ok:", res.get("ok"))
    if not res.get("ok"):
        print("error:", res.get("error"))
        sys.exit(1)

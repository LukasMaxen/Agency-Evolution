# Git Auto-Sync Skill — Agency Evolution

This file documents the full auto-sync setup for the Agency Evolution repo. Read this before any task involving git sync, push/pull automation, teammate onboarding, or troubleshooting sync issues.

---

## What the System Does

Every time any team member makes a commit in VS Code or the terminal:
1. **Pre-commit hook** → automatically pulls the latest from GitHub first (avoids conflicts)
2. **Commit happens**
3. **Post-commit hook + VS Code setting** → automatically pushes to GitHub immediately

Every 30 seconds in VS Code:
- Auto-fetches from GitHub and shows a badge if teammates have pushed new changes

---

## Repo & Remote

- **GitHub repo:** `https://github.com/LukasMaxen/Agency-Evolution`
- **Branch:** `main`
- **Remote alias:** `origin`

---

## Files That Power the Sync

| File | Purpose |
|---|---|
| `.githooks/pre-commit` | Pulls from GitHub before every commit |
| `.githooks/post-commit` | Pushes to GitHub after every commit |
| `scripts/auto-sync.sh` | Background sync script (used by LaunchAgent) |
| `setup-hooks.sh` | One-time setup script each teammate runs on their machine |
| `.vscode/settings.json` | VS Code git settings — auto-fetch, auto-push on commit |

### `.vscode/settings.json` — key settings
```json
{
  "git.autofetch": true,
  "git.autofetchPeriod": 30,
  "git.postCommitCommand": "push",
  "git.confirmSync": false,
  "git.enableSmartCommit": true,
  "git.smartCommitChanges": "all",
  "git.rebaseWhenSync": true,
  "git.showPushSuccessNotification": true
}
```

### `.githooks/pre-commit` — auto-pull before commit
```bash
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
git fetch origin "$BRANCH" --quiet
BEHIND=$(git rev-list HEAD..origin/"$BRANCH" --count 2>/dev/null)
if [ "$BEHIND" -gt 0 ]; then
  git pull --rebase origin "$BRANCH"
fi
```

### `.githooks/post-commit` — auto-push after commit
```bash
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
git push origin "$BRANCH"
```

---

## Git Config (set per machine)

```bash
git config core.hooksPath .githooks   # already set via setup-hooks.sh
git config --global user.name "Lukas Maxen"
git config --global user.email "lukas@maxen-digital.com"
```

---

## New Teammate Setup (run once after cloning)

```bash
git clone https://github.com/LukasMaxen/Agency-Evolution
cd Agency-Evolution
bash setup-hooks.sh
```

Then on macOS, grant **Full Disk Access** to `/bin/bash`:
- System Settings → Privacy & Security → Full Disk Access → `+` → `Cmd+Shift+G` → `/bin` → select `bash`

Then set git identity:
```bash
git config --global user.name "Teammate Name"
git config --global user.email "teammate@email.com"
```

Also authenticate with GitHub (one of):
- `gh auth login` (easiest — GitHub CLI)
- SSH key added to GitHub account
- Personal Access Token

---

## Background LaunchAgent (macOS only)

A LaunchAgent runs `scripts/auto-sync.sh` every 60 seconds in the background.
It auto-commits and pushes any local file changes, and pulls new commits from GitHub.

- **Plist:** `~/Library/LaunchAgents/com.agencyevolution.autosync.plist`
- **Script copy:** `~/Library/Scripts/agency-evolution-autosync.sh`
- **Logs:** `/tmp/agency-evolution-autosync.log` and `/tmp/agency-evolution-autosync-error.log`

### Start / stop / restart
```bash
# Restart
launchctl unload ~/Library/LaunchAgents/com.agencyevolution.autosync.plist
launchctl load ~/Library/LaunchAgents/com.agencyevolution.autosync.plist

# Check status
launchctl list | grep agencyevolution

# Watch live log
tail -f /tmp/agency-evolution-autosync.log
tail -f /tmp/agency-evolution-autosync-error.log
```

### Known issue: macOS TCC (disk access) blocking LaunchAgent
If you see `fatal: Unable to read current working directory: Operation not permitted` in the error log, the LaunchAgent does not have permission to access `~/Documents`.

**Fix:** System Settings → Privacy & Security → Full Disk Access → add `/bin/bash`

After granting access, restart the LaunchAgent with the commands above.

### Update the script after any changes to `scripts/auto-sync.sh`
The LaunchAgent runs a COPY of the script stored in `~/Library/Scripts/`. After editing `scripts/auto-sync.sh`, update the copy:
```bash
cp scripts/auto-sync.sh ~/Library/Scripts/agency-evolution-autosync.sh
chmod +x ~/Library/Scripts/agency-evolution-autosync.sh
```
Then restart the LaunchAgent.

---

## How Push & Pull Work — Full Flow

```
You save + commit a file in VS Code
  → pre-commit hook fires → pulls latest from GitHub (rebase)
  → commit is created
  → post-commit hook fires → pushes to GitHub immediately
  → VS Code git.postCommitCommand also triggers a push (redundant safety net)

Teammate pushes a change
  → within 30 seconds: VS Code auto-fetches and shows a badge
  → next time you commit: pre-commit hook pulls it automatically
  → OR: LaunchAgent pulls it in the background (if disk access is granted)
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Push fails with "rejected" | Teammate pushed while you were working | Run `git pull --rebase origin main` then push again |
| `Operation not permitted` in error log | macOS TCC blocking LaunchAgent | Add `/bin/bash` to Full Disk Access in System Settings |
| Hooks not firing | `core.hooksPath` not set | Run `git config core.hooksPath .githooks` |
| Changes not showing on GitHub | File was saved but never committed | Commit via VS Code source control panel or terminal |
| LaunchAgent not running after reboot | Plist not loaded | Run `launchctl load ~/Library/LaunchAgents/com.agencyevolution.autosync.plist` |
| Merge conflict during auto-sync | Two people edited the same file | Resolve conflict manually: `git status` → edit conflicted files → `git add` → `git rebase --continue` |

---

## What Does NOT Need Manual Steps

- Pushing after a commit — automatic via post-commit hook
- Pulling before a commit — automatic via pre-commit hook
- Fetching teammate changes in VS Code — automatic every 30 seconds

## What Still Requires a Manual Action

- **Committing** — you must commit via VS Code's source control panel or terminal. Once you do, everything else is automatic.
- **Resolving merge conflicts** — cannot be automated, must be done manually.

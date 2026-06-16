# Git Workflow

Read this before any task involving: creating a branch, opening a pull request, reviewing a PR, merging code, pulling a teammate's work, or shipping a new feature/skill/context file.

---

## Two-Track System

| Track | What goes here | Branch? | PR? |
|---|---|---|---|
| **Content** | `departments/`, `CLAUDE.md` | No — commit directly to `main` | No |
| **Code** | `app/`, `components/`, `lib/`, config files | Yes — always use a feature branch | Yes — required |

Auto-sync (GitDoc + hooks) handles content track automatically. The code track requires the manual branch → PR → merge flow below.

---

## Repo Facts

- **GitHub:** `https://github.com/LukasMaxen/Agency-Evolution`
- **Main branch:** `main`
- **Remote alias:** `origin`
- **Team:** Lukas, Kasper, Sunny — each with their own machine and Claude Code instance

---

## Code Track — Branch & PR Workflow

### 1. Start a feature branch

Always branch off the latest `main`:

```bash
git checkout main
git pull origin main
git checkout -b feat/your-feature-name
```

Branch naming:
- `feat/description` — new feature
- `fix/description` — bug fix
- `chore/description` — refactor, config, tooling
- `docs/description` — documentation only

### 2. Commit often

```bash
git add path/to/changed/files
git commit -m "feat: short description of what and why"
```

### 3. Push and open a PR

```bash
git push -u origin feat/your-feature-name
gh pr create --title "feat: short description" --body "..."
```

### 4. Review checklist

Before approving any PR:

- [ ] `npm run build` passes (no TypeScript errors)
- [ ] `npm run lint` passes
- [ ] No `console.log` left in production code
- [ ] No hardcoded secrets or credentials
- [ ] DB queries use parameterized placeholders (`$1, $2`) — no string interpolation
- [ ] No mock data imported directly into components
- [ ] The `ReplyDetail.tsx` "View in EmailBison" `<a` tag is intact if that file was touched

### 5. Merge (squash)

```bash
gh pr merge --squash --delete-branch
```

---

## Content Track — Direct to Main

Department docs, playbooks, and `CLAUDE.md` edits go straight to `main` — no PR needed. GitDoc auto-sync handles this when you save in VS Code. For manual commits:

```bash
git add departments/campaign-strategy/act-capital.md
git commit -m "docs: update ACT Capital messaging angle"
```

---

## Auto-Sync (GitDoc)

Every time you save a file in VS Code:
1. GitDoc waits 30 seconds after the last save, then auto-commits
2. Pre-commit hook pulls latest from GitHub first (avoids conflicts)
3. Post-commit hook pushes to GitHub immediately

**Required:** GitDoc extension (VS Code → Extensions → search "GitDoc" → Install → Enable)

The `.vscode/settings.json` already has all settings configured. New teammates run `bash setup-hooks.sh` once after cloning.

---

## New Teammate Setup

```bash
git clone https://github.com/LukasMaxen/Agency-Evolution
cd Agency-Evolution
bash setup-hooks.sh
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
gh auth login
```

On macOS, grant Full Disk Access to `/bin/bash`: System Settings → Privacy & Security → Full Disk Access → `+` → `/bin/bash`

---

## Conflict Resolution

```bash
git status                    # see which files conflict
# edit conflicted files — remove <<<<< ===== >>>>> markers
git add path/to/resolved/file
git rebase --continue
```

Never force push to `main`.

---

## Quick Reference

```bash
# Start new feature
git checkout main && git pull origin main
git checkout -b feat/name

# Push & open PR
git push -u origin feat/name
gh pr create --title "feat: name" --body "..."

# Merge (squash)
gh pr merge 42 --squash --delete-branch

# Pull after someone merges
git checkout main && git pull origin main
```

# Git Workflow Skill — Agency Evolution

Read this before any task involving: creating a branch, opening a pull request, reviewing a PR, merging code, pulling a teammate's work, or shipping a new feature/skill/context file.

---

## Two-Track System

| Track | What goes here | Branch? | PR? |
|---|---|---|---|
| **Content** | `skills/`, `context/`, `team/`, `CLAUDE.md` | No — commit directly to `main` | No |
| **Code** | `app/`, `components/`, `lib/`, `scripts/`, config files | Yes — always use a feature branch | Yes — required |

Auto-sync (GitDoc + hooks) handles content track automatically. The code track requires the manual branch → PR → merge flow below.

---

## Repo Facts

- **GitHub:** `https://github.com/LukasMaxen/Agency-Evolution`
- **Main branch:** `main`
- **Remote alias:** `origin`
- **Team:** three people, each with their own machine and Claude Code instance

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
- `feat/description` — new feature or skill
- `fix/description` — bug fix
- `chore/description` — refactor, config, tooling
- `docs/description` — documentation only

### 2. Do the work

Make your changes. Commit often with clear messages:

```bash
git add path/to/changed/files
git commit -m "feat: short description of what and why"
```

Commit message format: `type: description` where type is `feat`, `fix`, `chore`, `docs`, `refactor`.

### 3. Push the branch

```bash
git push -u origin feat/your-feature-name
```

### 4. Open a pull request

```bash
gh pr create \
  --title "feat: short description" \
  --body "$(cat <<'EOF'
## What
Brief description of the change.

## Why
The motivation or problem this solves.

## Test plan
- [ ] Ran `npm run build` locally — no errors
- [ ] Ran `npm run lint` — no warnings
- [ ] Tested the changed UI path manually (if applicable)
- [ ] No mock data imported into production-path components
EOF
)"
```

Or open in browser: `gh pr view --web`

### 5. Review checklist (for the reviewer)

Before approving any PR, verify:

- [ ] `npm run build` passes (no TypeScript errors)
- [ ] `npm run lint` passes
- [ ] No `console.log` left in production code
- [ ] No hardcoded secrets, tokens, or credentials
- [ ] DB queries use parameterized placeholders (`$1, $2`) — no string interpolation
- [ ] New API routes follow the pattern in CLAUDE.md (async params, try/catch, `{ error }` response)
- [ ] No mock data imported directly into components (use API routes instead)
- [ ] The `ReplyDetail.tsx` "View in EmailBison" `<a` tag is intact if that file was touched

Approve: `gh pr review --approve`
Request changes: `gh pr review --request-changes --body "reason"`

### 6. Merge

Only the author OR the reviewer merges — not both. Use squash merge to keep `main` history clean:

```bash
gh pr merge --squash --delete-branch
```

Or via GitHub UI: **Squash and merge** → **Confirm**.

### 7. After merge — all teammates pull

Each person on their machine:

```bash
git checkout main
git pull origin main
```

---

## Content Track — Direct to Main

Skills, context docs, and `CLAUDE.md` edits go straight to `main` — no PR needed. The auto-sync system handles this automatically when you save in VS Code. For manual commits:

```bash
git add skills/new-skill.md context/new-context.md
git commit -m "docs: add X skill / update Y context"
# post-commit hook pushes automatically
```

---

## Pulling a Teammate's Feature Branch (to test locally)

```bash
git fetch origin
git checkout feat/their-feature-name
# test it
git checkout main  # when done
```

---

## Conflict Resolution

If `git pull --rebase` stops with a conflict:

```bash
git status                    # see which files conflict
# edit conflicted files — remove <<<<< ===== >>>>> markers
git add path/to/resolved/file
git rebase --continue
```

Never use `git push --force` on `main`. On a feature branch it is acceptable.

---

## Who Does What

| Person | Setup on their machine |
|---|---|
| All three | `gh auth login` (GitHub CLI authenticated) |
| All three | `bash setup-hooks.sh` (run once after clone) |
| All three | Git identity: `git config --global user.name` / `user.email` |

See `skills/GIT_SYNC_SKILL.md` for the full auto-sync setup each machine needs.

---

## Quick Reference

```bash
# Start new feature
git checkout main && git pull origin main
git checkout -b feat/name

# Push & open PR
git push -u origin feat/name
gh pr create --title "feat: name" --body "..."

# Review someone's PR
gh pr list
gh pr checkout 42
npm run build && npm run lint
gh pr review 42 --approve

# Merge (squash)
gh pr merge 42 --squash --delete-branch

# Pull after someone merges
git checkout main && git pull origin main

# Check what's open
gh pr list
```

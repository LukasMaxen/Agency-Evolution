# GitDoc Setup — Plan of Action

Follow these steps to get automatic git sync working in VS Code, matching the team standard.

---

## Step 1 — Install GitDoc Extension

1. Open VS Code
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows) to open Extensions
3. Search for **GitDoc**
4. Install the extension by **vsls-contrib** (full ID: `vsls-contrib.gitdoc`)

---

## Step 2 — Pull Latest from Remote

Make sure you have the latest workspace settings (which include GitDoc config):

```bash
git pull
```

---

## Step 3 — Verify It's Working

1. Open any file in the project and make a small edit
2. Save the file (`Cmd+S` / `Ctrl+S`)
3. Wait ~30 seconds
4. Run `git log --oneline -3` in the terminal — you should see an `auto-sync:` commit appear

---

## What This Does

Once set up, VS Code will automatically:

| Action | Trigger |
|---|---|
| Commit all saved changes | 30 seconds after you save a file |
| Push to remote | Immediately after each auto-commit |
| Fetch from remote | Every 30 seconds in the background |

You will no longer need to manually run `git add`, `git commit`, or `git push` during normal development.

---

## Troubleshooting

**No auto-sync commits appearing?**
- Confirm GitDoc is installed and enabled (check the bottom status bar in VS Code for a GitDoc indicator)
- Make sure you are on a branch that has a remote tracking branch (`git push -u origin <branch>` if needed)

**Merge conflicts on pull?**
- This setup uses rebase on sync (`git.rebaseWhenSync: true`) — resolve conflicts normally and continue with `git rebase --continue`

**Want to disable auto-sync temporarily?**
- Open Command Palette (`Cmd+Shift+P`) → search **GitDoc: Disable**

#!/bin/bash
# Auto-sync: runs every 60 seconds in the background via LaunchAgent.
# 1. Pulls any new changes from GitHub
# 2. Detects local file changes, auto-commits, and pushes to GitHub

PROJECT_DIR="$1"

if [ -z "$PROJECT_DIR" ]; then
  echo "Error: No project directory specified"
  exit 1
fi

cd "$PROJECT_DIR" || exit 1

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

# Pull any new commits from GitHub first
git fetch origin "$BRANCH" --quiet 2>/dev/null
BEHIND=$(git rev-list HEAD..origin/"$BRANCH" --count 2>/dev/null)

if [ "$BEHIND" -gt 0 ]; then
  echo "[$TIMESTAMP] Pulling $BEHIND new commit(s) from GitHub..."
  git pull --rebase origin "$BRANCH" --quiet
  echo "[$TIMESTAMP] ✅ Pulled latest changes"
fi

# Check for any local uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "[$TIMESTAMP] Local changes detected — auto-committing and pushing..."
  git add -A
  git commit -m "auto-sync: $TIMESTAMP" --no-verify --quiet
  git push origin "$BRANCH" --quiet
  echo "[$TIMESTAMP] ✅ Pushed to GitHub"
fi

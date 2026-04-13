#!/bin/bash
# Run this script ONCE on your machine to activate auto-sync git hooks.
# After running this, every commit will automatically pull the latest changes
# from GitHub and then push your commit up automatically.
#
# Usage: bash setup-hooks.sh

echo "Setting up auto-sync git hooks..."

# Point git to the shared hooks directory
git config core.hooksPath .githooks

# Make hooks executable
chmod +x .githooks/pre-commit
chmod +x .githooks/post-commit

echo ""
echo "✅ Done! Auto-sync is now active on this machine."
echo ""
echo "From now on:"
echo "  • Before every commit: your branch will auto-pull the latest from GitHub"
echo "  • After every commit:  your changes will auto-push to GitHub"
echo ""
echo "Team members: clone the repo and run this same script once."

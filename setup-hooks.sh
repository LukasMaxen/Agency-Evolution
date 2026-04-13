#!/bin/bash
# Run this script ONCE on your machine to activate full auto-sync.
# After running this:
#   - Any file you save will be auto-committed and pushed to GitHub within 60 seconds
#   - Your machine will also auto-pull changes from teammates every 60 seconds
#   - This runs silently in the background and starts automatically on login
#
# Usage: bash setup-hooks.sh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_LABEL="com.agencyevolution.autosync"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

echo "Setting up auto-sync for: $PROJECT_DIR"
echo ""

# Step 1: Set up git commit hooks
echo "1/3 Configuring git hooks..."
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
chmod +x .githooks/post-commit
chmod +x scripts/auto-sync.sh
echo "   ✅ Git hooks active"

# Step 2: Install LaunchAgent (runs auto-sync every 60 seconds, survives reboot)
echo "2/3 Installing background auto-sync service..."
mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Scripts"

# Copy script to ~/Library/Scripts so background services can access it
# (macOS blocks LaunchAgents from directly accessing the Desktop folder)
SCRIPT_DEST="$HOME/Library/Scripts/agency-evolution-autosync.sh"
cp "$PROJECT_DIR/scripts/auto-sync.sh" "$SCRIPT_DEST"
chmod +x "$SCRIPT_DEST"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DEST</string>
        <string>$PROJECT_DIR</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/agency-evolution-autosync.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/agency-evolution-autosync-error.log</string>
</dict>
</plist>
PLIST

echo "   ✅ LaunchAgent installed"

# Step 3: Start the service now (no reboot needed)
echo "3/3 Starting auto-sync service..."
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
echo "   ✅ Auto-sync is running"

echo ""
echo "✅ All done! Auto-sync is fully active on this machine."
echo ""
echo "From now on (no manual steps needed):"
echo "  • Save a file → auto-committed and pushed to GitHub within 60 seconds"
echo "  • Teammate pushes → your machine pulls it automatically within 60 seconds"
echo "  • Runs silently in the background and restarts automatically on login"
echo ""
echo "To check the sync log:  cat /tmp/agency-evolution-autosync.log"
echo "To stop auto-sync:      launchctl unload $PLIST_PATH"

#!/bin/bash
echo "Auto-sync started — checking for updates every 60 seconds"
while true; do
  git pull origin main --quiet
  sleep 60
done
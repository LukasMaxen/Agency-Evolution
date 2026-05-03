-- Migration 008: Per-workspace Slack channel + Airtable config for in-app notifications
-- Folds Make.com per-client scenarios into one handler in the Next.js app.
-- Run as postgres superuser:
--   sudo -u postgres psql -p 5433 -d ai_reply_desk -f migrations/008_workspace_notification_config.sql

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS slack_channel_replies   TEXT,
  ADD COLUMN IF NOT EXISTS slack_channel_meetings  TEXT,
  ADD COLUMN IF NOT EXISTS airtable_base_id        TEXT,
  ADD COLUMN IF NOT EXISTS airtable_meetings_table TEXT DEFAULT 'Meetings',
  ADD COLUMN IF NOT EXISTS airtable_leads_table    TEXT DEFAULT 'Leads';

-- slack_channel_replies   -> client's [client]-replies channel (every email reply, interested or not)
-- slack_channel_meetings  -> client's [client]-meetings channel (Calendly bookings)
-- airtable_base_id        -> client's Airtable base ID (one base per client)
-- airtable_meetings_table -> table name in that base for meeting bookings
-- airtable_leads_table    -> table name in that base for interested leads

-- Migration 009: forward_replies_to_email on workspaces
-- Code in app/api/auto-reply/processor.ts already references this column,
-- the SELECT throws on every inbound reply when the column is missing.
-- Run as postgres superuser:
--   sudo -u postgres psql -p 5433 -d ai_reply_desk -f migrations/009_forward_replies_to_email.sql

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS forward_replies_to_email TEXT;

-- forward_replies_to_email -> when set, interested-family replies for this workspace
-- are forwarded to this email instead of being auto-replied or drafted. Used by the
-- "client handles their own interested replies" flow (eg hahnbeck).

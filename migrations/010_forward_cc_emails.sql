-- Migration 010: forward_cc_emails on workspaces
-- Comma-separated list of addresses to CC on every forward email
-- (interested replies forwarded to forward_replies_to_email).
-- Run as postgres superuser:
--   sudo -u postgres psql -p 5433 -d ai_reply_desk -f migrations/010_forward_cc_emails.sql

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS forward_cc_emails TEXT;

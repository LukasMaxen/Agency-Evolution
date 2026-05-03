-- Migration 006: Recipient override on replies
-- When a lead's reply is from a different person (forward, redirect, EA),
-- the auto-reply must go to that new person, not the original lead.
-- Run as postgres superuser:
--   sudo -u postgres psql -p 5433 -d ai_reply_desk -f migrations/006_recipient_override.sql

ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS preferred_recipient_email TEXT,
  ADD COLUMN IF NOT EXISTS preferred_recipient_name TEXT;

-- Both fields are NULL by default. Populated by the auto-reply processor only
-- when Claude detects a forward/redirect in the lead's reply text. All send
-- paths (auto-reply direct send, Slack-approved send, FU send) check these
-- fields first and fall back to lead_email / lead_name when null.

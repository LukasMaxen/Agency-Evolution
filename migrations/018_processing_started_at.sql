-- Migration 018: Track when a reply entered 'processing'
-- The self-sweeper resets stuck 'processing' rows back to 'new' after a deploy or
-- crash kills the in-flight processor. Previously that reset keyed off received_at
-- (30-min window), so a reply caught in a deploy waited up to 30 minutes before
-- re-queue, even though it was only mid-flight for seconds. Keying off when the row
-- actually entered 'processing' lets the sweeper recover it in ~5 minutes instead.
-- Run as postgres superuser:
--   sudo -u postgres psql -p 5433 -d ai_reply_desk -f migrations/018_processing_started_at.sql

ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ NULL;

-- Set by the atomic claim (status -> 'processing') in processAutoReplyImpl.
-- NULL means the row was never claimed, or was claimed before this migration.
-- The sweeper uses COALESCE(processing_started_at, received_at) so pre-migration
-- rows still get recovered.

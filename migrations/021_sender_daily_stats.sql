-- 021_sender_daily_stats.sql
-- Per-sender, per-day Sent/Bounced/Replied counts pulled from EB's
-- /api/campaign-events/stats endpoint -- the only EB endpoint that accepts
-- BOTH a sender_email_ids[] filter AND a date range, returning a real
-- day-by-day breakdown per sender. Populated by a daily background sync
-- (lib/sync-sender-daily-stats.ts), read by app/api/account-monitor/route.ts
-- so the dashboard never has to call EB live on a page load (a full sweep
-- at per-sender granularity takes ~50s -- fine for a background job, far
-- too slow for a request).
--
-- This replaces emails_sent/email_bounces as the source for the account
-- monitor dashboard specifically. Those tables remain the source of truth
-- for reply-management/follow-up workflows elsewhere in the app; this is
-- a separate, purpose-built cache.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS sender_daily_stats (
  id             BIGSERIAL PRIMARY KEY,
  workspace_slug TEXT NOT NULL,
  sender_email   TEXT NOT NULL,
  eb_sender_id   INTEGER,
  date           DATE NOT NULL,
  sent           INTEGER NOT NULL DEFAULT 0,
  bounced        INTEGER NOT NULL DEFAULT 0,
  replied        INTEGER NOT NULL DEFAULT 0,
  opened         INTEGER NOT NULL DEFAULT 0,
  interested     INTEGER NOT NULL DEFAULT 0,
  unsubscribed   INTEGER NOT NULL DEFAULT 0,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_slug, sender_email, date)
);

CREATE INDEX IF NOT EXISTS idx_sender_daily_stats_lookup
  ON sender_daily_stats (workspace_slug, sender_email, date DESC);

COMMIT;

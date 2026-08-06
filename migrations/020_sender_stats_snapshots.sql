-- 020_sender_stats_snapshots.sql
-- Periodic per-sender cumulative-counter snapshots, sourced from EB's own
-- /api/sender-emails and /api/warmup/sender-emails endpoints (lifetime
-- totals maintained by EB itself, independent of our EMAIL_SENT webhook).
--
-- Why: EMAIL_SENT/MANUAL_EMAIL_SENT/EMAIL_OPENED webhook delivery stopped
-- for every workspace on 2026-07-30 (LEAD_REPLIED and EMAIL_BOUNCED kept
-- working), so the local emails_sent table stopped growing. There is no EB
-- endpoint that exposes individual timestamped send events with sender
-- attribution, but /api/sender-emails does expose a running lifetime count
-- per sender (emails_sent_count, bounced_count, total_replied_count) that
-- keeps incrementing regardless of webhook health.
--
-- Snapshotting that counter hourly (see app/api/sync-sender-accounts)
-- lets the account-monitor dashboard compute a window's sends as
-- (latest snapshot - snapshot nearest the window start), which is accurate
-- and webhook-independent. Storing warmup_score in the same row also gives
-- a warmup-health trajectory over time instead of only the current value.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS sender_stats_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  workspace_slug        TEXT NOT NULL,
  sender_email          TEXT NOT NULL,
  eb_sender_id          INTEGER,
  snapshot_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  emails_sent_count     INTEGER,
  total_replied_count   INTEGER,
  bounced_count         INTEGER,
  warmup_score          NUMERIC,
  warmup_daily_limit    INTEGER,
  daily_limit           INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sender_stats_snapshots_lookup
  ON sender_stats_snapshots (workspace_slug, sender_email, snapshot_at DESC);

COMMIT;

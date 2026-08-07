-- 022_sender_warmup_periods.sql
-- Per-sender warmup score for fixed trailing periods (3/7/10/30 days,
-- matching the windows EmailBison's own Sender Accounts dashboard shows),
-- plus the same-length PRIOR period's score so a week-over-week (etc.)
-- delta can be shown without any extra live EB calls at read time.
--
-- Populated by a daily background sync (app/api/sync-sender-warmup-history)
-- via EB's /api/warmup/sender-emails?start_date=&end_date=, which returns
-- a real windowed score (confirmed live: querying a months-old date range
-- returns a different score than querying last week, so this isn't just
-- returning "current live score" regardless of the requested window).
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS sender_warmup_periods (
  id             BIGSERIAL PRIMARY KEY,
  workspace_slug TEXT NOT NULL,
  sender_email   TEXT NOT NULL,
  eb_sender_id   INTEGER,
  period_days    INTEGER NOT NULL,        -- 3, 7, 10, or 30
  current_score  NUMERIC,                  -- score for [today - period_days, today]
  prior_score    NUMERIC,                  -- score for [today - 2*period_days, today - period_days]
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_slug, sender_email, period_days)
);

CREATE INDEX IF NOT EXISTS idx_sender_warmup_periods_lookup
  ON sender_warmup_periods (workspace_slug, sender_email, period_days);

COMMIT;

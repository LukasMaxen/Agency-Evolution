-- Migration 007: Persist weekly review summaries so auto-apply can read them back
-- Run as postgres superuser:
--   sudo -u postgres psql -p 5433 -d ai_reply_desk -f migrations/007_weekly_reviews.sql

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id            TEXT PRIMARY KEY,
  slack_ts      TEXT NOT NULL,
  channel       TEXT,
  summary       JSONB NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending',
  applied_at    TIMESTAMPTZ,
  applied_by    TEXT,
  commit_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- status values: pending | applied | skipped
-- summary JSON shape: { headline, patterns: [{title, examples_count, proposed_rule_change, target_file, confidence}], one_off_notes: [] }

CREATE INDEX IF NOT EXISTS idx_weekly_reviews_slack_ts ON weekly_reviews (slack_ts);
CREATE INDEX IF NOT EXISTS idx_weekly_reviews_status ON weekly_reviews (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON weekly_reviews TO aird;

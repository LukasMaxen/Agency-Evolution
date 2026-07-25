-- 019_sender_daily_limits.sql
-- Adds per-sender limit and metadata columns that power the direct
-- EmailBison controls and metadata display in the Account Monitor.
--
--   daily_limit        Outbound sending cap (emails/day). Populated from
--                      EB /api/sender-emails during sync.
--   warmup_daily_limit Warmup email cap (emails/day). Populated from
--                      EB /api/warmup/sender-emails during sync.
--   tags               Array of EB tags on the sender account (JSONB).
--   eb_created_at      When the sender was added in EmailBison.
--
-- Idempotent.

BEGIN;

ALTER TABLE sender_accounts
  ADD COLUMN IF NOT EXISTS daily_limit        INTEGER,
  ADD COLUMN IF NOT EXISTS warmup_daily_limit INTEGER,
  ADD COLUMN IF NOT EXISTS tags               JSONB,
  ADD COLUMN IF NOT EXISTS eb_created_at      TIMESTAMPTZ;

COMMIT;

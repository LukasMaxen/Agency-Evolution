-- 016_sender_warmup_score.sql
-- Adds EmailBison's warmup_score per sender. The Warmup Monitor uses this
-- as the "Warmup health %" KPI. Source: /api/warmup/sender-emails returns
-- warmup_score along with warmup_enabled, warmup_emails_sent, etc.
-- Targets: >= 98 healthy (green), 90-97 watch (amber), < 90 problem (red).
--
-- Idempotent.

BEGIN;

ALTER TABLE sender_accounts
  ADD COLUMN IF NOT EXISTS warmup_score NUMERIC;

COMMIT;

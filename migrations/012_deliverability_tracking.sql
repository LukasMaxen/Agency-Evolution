-- 012_deliverability_tracking.sql
-- Enriches email_bounces with subject/body/classification fields so we can
-- distinguish data failures (bad recipient) from domain burn (our domain is
-- being throttled or blocked). Populated by the new ?type=Bounced poll
-- added to lib/emailbison-inbox-sync.ts.
--
-- Option B id strategy: keep id TEXT to preserve 10k+ historical rows from
-- the EMAIL_BOUNCED webhook path. New poll rows are inserted with prefixed
-- ids like 'bounce-poll-{slug}-{eb_reply_id}'. The raw numeric EB id is
-- stored in eb_reply_id and the EB uuid in eb_reply_uuid (unique-indexed)
-- so ingestion is idempotent.
--
-- Idempotent: every clause uses IF NOT EXISTS. Safe to re-run.

BEGIN;

ALTER TABLE email_bounces
  ADD COLUMN IF NOT EXISTS sender_email     TEXT,
  ADD COLUMN IF NOT EXISTS sender_email_id  INTEGER,
  ADD COLUMN IF NOT EXISTS eb_reply_id      INTEGER,
  ADD COLUMN IF NOT EXISTS eb_reply_uuid    TEXT,
  ADD COLUMN IF NOT EXISTS bounce_subject   TEXT,
  ADD COLUMN IF NOT EXISTS bounce_reason    TEXT,
  ADD COLUMN IF NOT EXISTS bounce_category  TEXT,
  ADD COLUMN IF NOT EXISTS provider         TEXT;

-- The Bounced-folder poll does not carry the recipient email directly
-- (it is only embedded in the body text). Allow NULL so the new poll path
-- can ingest bounces. Existing webhook-path rows already have lead_email
-- populated and are unaffected.
ALTER TABLE email_bounces ALTER COLUMN lead_email DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS email_bounces_eb_reply_uuid_uidx
  ON email_bounces (eb_reply_uuid)
  WHERE eb_reply_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_bounces_sender_email_idx
  ON email_bounces (workspace_slug, sender_email, bounced_at DESC);

CREATE INDEX IF NOT EXISTS email_bounces_category_idx
  ON email_bounces (workspace_slug, bounce_category, bounced_at DESC);

COMMIT;

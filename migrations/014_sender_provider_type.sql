-- 014_sender_provider_type.sql
-- Captures EmailBison's `type` field per sender ('google_workspace_oauth',
-- 'microsoft_oauth', 'imap', etc.) so we can filter senders by provider in
-- the deliverability dashboard. Microsoft mailboxes are excluded from the
-- account monitor entirely (per business decision: Outlook is not part of
-- the tracked-deliverability product line).
--
-- Idempotent. Safe to re-run.

BEGIN;

ALTER TABLE sender_accounts
  ADD COLUMN IF NOT EXISTS provider_type TEXT;

CREATE INDEX IF NOT EXISTS sender_accounts_provider_idx
  ON sender_accounts (workspace_slug, provider_type);

COMMIT;

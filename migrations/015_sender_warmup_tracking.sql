-- 015_sender_warmup_tracking.sql
-- Adds two pieces of state to sender_accounts that the Warmup Monitor view
-- depends on:
--
--   warming_since           When the sender was last put on warmup-only
--                           (via the Remove + warmup action). NULL means the
--                           sender is not currently in a warmup-only cycle.
--                           Used to display "Warming for X days" and to flag
--                           senders that have completed the standard 2-week
--                           warmup window and are ready to rejoin campaigns.
--
--   attached_campaigns_count How many active EmailBison campaigns this sender
--                           is currently attached to. Populated by
--                           /api/sync-sender-accounts. 0 means the sender is
--                           in EB's sender list but not actively running on
--                           any campaign (either fresh, paused, or just
--                           detached via Remove all).
--
-- Idempotent. Safe to re-run.

BEGIN;

ALTER TABLE sender_accounts
  ADD COLUMN IF NOT EXISTS warming_since            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attached_campaigns_count INTEGER;

CREATE INDEX IF NOT EXISTS sender_accounts_warming_since_idx
  ON sender_accounts (warming_since)
  WHERE warming_since IS NOT NULL;

COMMIT;

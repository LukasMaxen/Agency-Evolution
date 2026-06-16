-- 013_reply_tracking_flag.sql
-- Adds the EmailBison "tracked vs untracked" reply classification to our
-- replies table. EB marks each reply with type = 'Tracked Reply' (an actual
-- response to a campaign send, has a campaign_id) or 'Untracked Reply' (an
-- email landing in a sender mailbox that wasn't sent by us, e.g. newsletter
-- subscriptions, inbound cold outreach, transactional mail).
--
-- Our deliverability KPIs (reply rate, interested rate) should ONLY count
-- tracked replies. The inbox-sync poller historically ingested both, which
-- inflated reply counts with newsletter noise.
--
-- Idempotent: every clause uses IF NOT EXISTS. Safe to re-run.

BEGIN;

ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS reply_type    TEXT,
  ADD COLUMN IF NOT EXISTS tracked_reply BOOLEAN;

CREATE INDEX IF NOT EXISTS replies_tracked_idx
  ON replies (workspace_slug, tracked_reply, received_at DESC)
  WHERE tracked_reply IS NOT NULL;

COMMIT;

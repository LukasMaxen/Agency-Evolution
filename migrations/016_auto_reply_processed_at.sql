-- Adds a dedicated done-flag for the auto-reply processor so the sweeper can
-- tell "processor has run on this row" apart from "user opened this row".
--
-- Before this column, the sweeper used status='new' as the only trigger. If a
-- user clicked a 'new' reply in the dashboard, MasterInbox PATCHed status to
-- 'read', and the sweeper's safety-net retry path would then skip the row
-- even if the primary webhook -> /run path had failed. Result: replies that
-- you opened during the 2-minute hold could end up never going to
-- #reply-approval.
--
-- New flow: processor.ts sets auto_reply_processed_at = NOW() on every
-- terminal write (read/awaiting_approval/awaiting_manual/replied/forwarded).
-- The sweeper picks up any reply where this is NULL and status is not
-- 'processing'/'errored', regardless of whether the user has read it.

ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS auto_reply_processed_at TIMESTAMPTZ;

-- Backfill: mark rows the processor actually ran on. Critical distinction:
--   * status='replied'/'forwarded'/'awaiting_approval'/'awaiting_manual' are
--     ONLY produced by the auto-reply processor or downstream Slack/send-reply
--     flows that run after the processor. Safe to backfill unconditionally.
--   * status='read' is produced by BOTH the processor (silent close) AND the
--     dashboard's "mark as read on open" PATCH. We only want to backfill the
--     processor's reads. Telltale: the processor's ai_analysis always carries
--     one of {action, skipped_reason, auto_replied, awaiting_approval,
--     forwarded_to}; the dashboard's /api/analyze writes only
--     {intent, urgency, summary, suggestedTemplateId, suggestedReply}, none of
--     those keys. status='read' rows that fail this shape check are exactly
--     the rows the user opened before the processor ran, and the sweeper
--     should pick them up after this migration.
UPDATE replies
   SET auto_reply_processed_at = COALESCE(ai_analyzed_at, received_at)
 WHERE auto_reply_processed_at IS NULL
   AND (
     status IN ('replied', 'forwarded', 'awaiting_approval', 'awaiting_manual', 'closed', 'errored')
     OR (
       status = 'read'
       AND ai_analysis IS NOT NULL
       AND (
         ai_analysis ? 'action'
         OR ai_analysis ? 'skipped_reason'
         OR ai_analysis ? 'auto_replied'
         OR ai_analysis ? 'awaiting_approval'
         OR ai_analysis ? 'forwarded_to'
       )
     )
   );

CREATE INDEX IF NOT EXISTS idx_replies_sweeper_pending
  ON replies (received_at)
  WHERE auto_reply_processed_at IS NULL
    AND status NOT IN ('processing', 'errored');

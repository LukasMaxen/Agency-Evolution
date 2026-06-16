-- Migration 005: Auto-reply approval flow + unified draft feedback table
-- Run as postgres superuser:
--   sudo -u postgres psql -p 5433 -d ai_reply_desk -f migrations/005_reply_approval_and_feedback.sql

-- ── workspaces: auto-reply approval mode flag ─────────────────────────────────

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS auto_reply_approval_mode BOOLEAN DEFAULT true;

-- Default true for all workspaces. Flip to false per workspace once first-response quality is trusted.

-- ── reply_drafts: staging table for auto-reply drafts pending approval ────────

CREATE TABLE IF NOT EXISTS reply_drafts (
  id                  TEXT PRIMARY KEY,
  reply_id            TEXT NOT NULL,
  workspace_slug      TEXT NOT NULL,
  lead_name           TEXT,
  lead_email          TEXT,
  intent              VARCHAR(30),
  action              VARCHAR(20),
  fu_sequence_type    VARCHAR(20),
  flag_unsubscribe    BOOLEAN DEFAULT false,
  flag_meeting_booked BOOLEAN DEFAULT false,
  manual_reason       TEXT,
  subject             TEXT,
  body                TEXT,
  status              VARCHAR(20) DEFAULT 'pending',
  slack_ts            TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         TEXT,
  sent_at             TIMESTAMPTZ
);

-- status values: pending | approved | rejected | sent

CREATE INDEX IF NOT EXISTS idx_reply_drafts_workspace_status ON reply_drafts (workspace_slug, status);
CREATE INDEX IF NOT EXISTS idx_reply_drafts_reply_id ON reply_drafts (reply_id);
CREATE INDEX IF NOT EXISTS idx_reply_drafts_slack_ts ON reply_drafts (slack_ts);

-- ── follow_up_drafts: add slack_ts index for fast reverse lookup ──────────────

CREATE INDEX IF NOT EXISTS idx_fu_drafts_slack_ts ON follow_up_drafts (slack_ts);

-- ── draft_feedback: unified table for thread replies on either draft type ─────

CREATE TABLE IF NOT EXISTS draft_feedback (
  id               TEXT PRIMARY KEY,
  draft_type       VARCHAR(20) NOT NULL,
  draft_id         TEXT NOT NULL,
  workspace_slug   TEXT,
  slack_user_id    TEXT,
  slack_user_name  TEXT,
  message_text     TEXT NOT NULL,
  action           VARCHAR(20) DEFAULT 'feedback',
  slack_ts         TEXT,
  parent_slack_ts  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- draft_type values: reply | follow_up
-- action values: feedback | approve_note | reject_note

CREATE INDEX IF NOT EXISTS idx_draft_feedback_draft ON draft_feedback (draft_type, draft_id);
CREATE INDEX IF NOT EXISTS idx_draft_feedback_workspace ON draft_feedback (workspace_slug, created_at DESC);

-- ── Grants for the application user ───────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON reply_drafts TO aird;
GRANT SELECT, INSERT, UPDATE, DELETE ON draft_feedback TO aird;

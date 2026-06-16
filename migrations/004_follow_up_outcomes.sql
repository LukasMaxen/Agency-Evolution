-- Migration 004: Follow-up outcome tracking + approval flow
-- Run manually against the PostgreSQL instance before deploying the follow-ups processor.

-- ── follow_ups: outcome tracking columns ──────────────────────────────────────

ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS fu_sequence_type VARCHAR(20) DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS converted_at_step INTEGER,
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(20);

-- outcome values: booked | re_engaged | exhausted | unsubscribed
-- fu_sequence_type values: full | abbreviated

-- ── workspaces: approval mode flag ────────────────────────────────────────────

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS fu_approval_mode BOOLEAN DEFAULT true;

-- Default true for all existing workspaces — team reviews every draft
-- before it sends. Turn off per workspace once output quality is trusted.

-- ── follow_up_drafts: staging table for approval flow ─────────────────────────

CREATE TABLE IF NOT EXISTS follow_up_drafts (
  id              TEXT PRIMARY KEY,
  follow_up_id    TEXT NOT NULL,
  reply_id        TEXT NOT NULL,
  workspace_slug  TEXT NOT NULL,
  lead_name       TEXT,
  lead_email      TEXT,
  fu_step         INTEGER NOT NULL,
  subject         TEXT,
  body            TEXT NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending',
  slack_ts        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     TEXT,
  sent_at         TIMESTAMPTZ
);

-- status values: pending | approved | rejected | sent

CREATE INDEX IF NOT EXISTS idx_fu_drafts_workspace_status
  ON follow_up_drafts (workspace_slug, status);

CREATE INDEX IF NOT EXISTS idx_fu_drafts_follow_up_id
  ON follow_up_drafts (follow_up_id);

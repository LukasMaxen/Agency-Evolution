-- Migration 017: Per-workspace reply-approval Slack channel
-- Routes a workspace's auto-reply approval + manual-replies cards to a dedicated channel
-- (e.g. a client-shared #reply-management). NULL falls back to the global #reply-approval.
-- Run as postgres superuser:
--   sudo -u postgres psql -p 5433 -d ai_reply_desk -f migrations/017_workspace_approval_channel.sql

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS slack_approval_channel TEXT NULL;

-- slack_approval_channel = Slack channel ID (e.g. "C0BATJ48BL3"), NOT the human-readable name.
-- IDs are stable across renames; names are not. NULL = use the global REPLY_APPROVAL_CHANNEL.
-- Both auto-reply approval cards AND manual-replies cards route here when set.

-- Sonaro AI test: route all its draft cards to the shared #reply-management channel
UPDATE workspaces
   SET slack_approval_channel = 'C0BATJ48BL3'
 WHERE slug = 'sonaro-ai';

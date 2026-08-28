// Temporary hardcoded workspace -> Slack channel map for the raw "every reply"
// notification feed (mirrors Make.com's unfiltered "Reply received" post, one
// message per inbound reply regardless of AI classification).
//
// This should really live in workspaces.slack_channel_replies (see
// migrations/008_workspace_notification_config.sql), which app/api/webhook/
// [workspace]/route.ts already reads. That migration has never been applied
// to production (needs a DB superuser, aird cannot run DDL), so the column
// does not exist and that code path is currently dead for every workspace.
// Hardcoded here so WithPebble and AEO Consulting work today without it.
// Once migration 008 runs, replace this with workspace.slack_channel_replies
// and delete this file.
export const RAW_REPLY_FEED_CHANNELS: Record<string, string> = {
  "with-pebble": "C0BSXAE4JLB",
  "ah-consulting": "C0BT77S0SJG",
};

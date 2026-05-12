---
name: CSM update delivery method
description: How to deliver the daily CSM update — format and post method
type: feedback
originSessionId: 5e526178-07e5-4082-b74d-425b17254b91
---
Never post the CSM update to Slack automatically. Always output the fully formatted update in chat so the user can edit and copy paste it into Slack themselves.

**Why:** User wants to post from their own Slack account so they can edit before sending.

**How to apply:** When asked for the daily/weekly numbers, pull the data, format it correctly matching the Slack format (bold client names, comma-separated thousands, percentage with comma decimal, efficiency section at bottom), and output it in the chat. Do not call slack_post_message unless the user explicitly asks you to post it for them.

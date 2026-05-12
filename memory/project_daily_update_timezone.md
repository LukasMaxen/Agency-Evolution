---
name: Daily update timezone
description: Timezone to use when querying DB for daily email performance updates
type: project
originSessionId: 86c5f10c-1da6-4cee-a11a-47e6f4abc57a
---
Use **UTC** when filtering DB queries for daily updates. The DB stores all timestamps as UTC. EmailBison tracks in UTC, so raw UTC comparisons match what EmailBison shows.

**How to apply:** When querying for a given date (e.g. May 6):
- `sent_at >= '2026-05-06 00:00:00' AND sent_at < '2026-05-07 00:00:00'`

Compute yesterday/next_day in UTC using `datetime.datetime.now(datetime.timezone.utc)`.

**Also:** Only count `sequence_step = 1` in emails_sent (initial outreach only, not follow-ups).

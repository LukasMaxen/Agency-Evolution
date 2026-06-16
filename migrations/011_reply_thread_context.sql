-- Stores the quoted email chain from the lead's raw reply body.
-- Used by the auto-reply processor to give Claude the full conversation context,
-- including what our original cold email said (e.g. "Mind if I share more info?").
ALTER TABLE replies ADD COLUMN IF NOT EXISTS thread_context TEXT;

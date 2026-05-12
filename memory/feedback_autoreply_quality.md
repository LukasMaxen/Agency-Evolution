---
name: Auto-reply quality rules — learned from May 12 incident
description: Rules for reviewing, debugging, and drafting auto-replies. Learned from the batch failure where 26 leads received "Hi [Name]," with no body.
type: feedback
originSessionId: 3cf40cc3-320b-497c-9022-3c5d906e8d72
---
Always check sent_emails for truncated bodies before trusting that auto-replies went out correctly. A body of "Hi [Name]," means the LLM output was cut off and the reply is broken.

**Why:** 26 leads received broken replies on May 11 because max_tokens was too low and there was no body length guard. The processor sent them silently.

**How to apply:**
- When reviewing auto-reply quality, query `sent_emails` filtering for body length < 20 chars (after removing signature) to catch truncated replies
- SQL: `WHERE LENGTH(TRIM(REPLACE(body, '{SENDER_EMAIL_SIGNATURE}', ''))) < 20`
- Any reply in that set needs a manual follow-up drafted and sent

---

Always check who actually wrote the reply before drafting. The lead email in the system may not be the person who replied.

**Why:** Benjamin Frohlichstein replied from ben@cappellos.com but the lead on record was heather@cappellos.com. The draft was correct but the send address would have been wrong.

**How to apply:**
- Read the full reply signature and From: address before drafting
- If the reply was written by someone other than the lead email, note the correct send address explicitly
- For manual sends, use `toEmailOverride` with the correct address
- The processor now auto-detects this via `detectAlternateSender()`, but for manual reviews always verify

---

When the auto-reply system has a batch failure (many broken replies in the same minute), check the sweep logs first.

**Why:** All 26 broken replies fired in the same 17:23-17:24 window. This was a batch from the sweeper, not individual webhook triggers. The concurrent Claude API load caused truncated output.

**How to apply:**
- Batch failures = sweeper or backfill script ran on many stuck replies at once
- Individual failure = webhook triggered a single bad Claude call
- Distinguishing the two changes the fix: batch = system-level (max_tokens, timeout), individual = content-level (prompt, context)

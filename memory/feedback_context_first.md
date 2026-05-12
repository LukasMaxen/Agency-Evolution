---
name: Always read context before starting any task
description: Before any task, read memory and relevant context files first. Never guess or assume.
type: feedback
originSessionId: 6f86efab-6c09-4fe5-b234-6e1ca510210d
---
Before starting any task:

1. Read all relevant memory files (`/memory` index and applicable entries)
2. Read relevant context files (`CONTEXT_Replies.md`, `SKILL_Reply-Managment.md`, client files, etc.)
3. Review existing project files if needed to understand prior decisions and patterns
4. Only begin implementation after reviewing context

If relevant context is missing or unclear, pause and ask for clarification instead of guessing.

**Why:** Acting without context leads to mistakes, repeated corrections, and inconsistent output.

**How to apply:** Every task, every time. No exceptions.

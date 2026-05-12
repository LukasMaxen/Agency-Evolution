---
name: Auto-reply delay and no-template rules
description: Two mandatory auto-reply rules: 6-minute send delay after lead replies, and no template auto-select — always draft from scratch using skill/context/client files
type: feedback
originSessionId: 5e943fa7-05e2-44d5-9321-84e862361d21
---
6-minute hold: Never send a reply the moment a lead responds. Always wait exactly 6 minutes after the lead's message timestamp. The processor enforces this in code, but also applies to manual replies.

No template auto-select: Do not select a template and send it. Templates caused wrong replies going to wrong leads. For every reply, follow the full drafting process: read skill file, follow-up context, client file, full thread, then draft from scratch. Templates are a reference floor only, never copy-paste.

**Why:** Template matching is unreliable. Immediate replies feel robotic and flag as spam. These are standing operating rules added 2026-05-11.

**How to apply:** Every reply, every time, no exceptions.

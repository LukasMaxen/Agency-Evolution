---
name: Templates are a floor, not a ceiling
description: When a template exists for an intent, always check if a better reply can be drafted given the specific lead context
type: feedback
originSessionId: e6e61939-a8ae-44b6-b1e8-e2c86828a51c
---
For template-path intents (unsubscribe, hard no, wrong target, soft no, OOO), do not blindly load and send the template. Always check first whether a better, more personalised reply can be drafted given the lead's specific message, company, tone, and thread context.

**Why:** Templates are good enough for generic cases but real replies with specific context deserve a tailored response. The template is the floor, not the ceiling.

**How to apply:** Load the template, then assess: does the lead's message give enough specific context to do better? If yes, draft a fresh reply using the template as a structural guide. If the template is genuinely the best fit (e.g. a two-word "remove me"), use it as-is. Always prefer the better reply.

---
name: x-account
description: Runs Kasper's X account (@KasperZacho_) in his logged-in Chrome via Claude in Chrome. Invoke whenever Kasper says "post", "comment", "reply", "schedule next week", "rewrite the scheduled posts", "continue comments", or asks for X comments/replies/posts (e.g. "10 comments in the next 30 min"). Covers voice rules, targeting rules, search method, posting/scheduling mechanics and logging.
---

# X Account (@KasperZacho_)

Everything Kasper taught about his X account lives here plus 4 memory files. A fresh session must behave exactly like the long-running one. Do not improvise.

## 0. Before ANY X action, read these (every session, no exceptions)

Memory dir: `~/.claude/projects/-Users-kasperaggerholm-Agency-Evolution/memory/`
1. `feedback_x_sound_human.md` (AUTHORITATIVE voice + behavior rules, Kasper-written)
2. `project_x_comment_routine.md` (comment rules, search method, run log, who was already commented on)
3. `project_x_reply_routine.md` (reply + auto-like rules, run log)
4. `project_x_post_rotation.md` (what "post" means, scheduling, topics already used, scheduled week)
5. For any cold email claim: `1. Departments/cold email campaigns/CONTEXT_Campaign.md` (sequence structure, CTA rules)

Load browser tools in ONE ToolSearch call: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__browser_batch,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__get_page_text`. Then `tabs_context_mcp` and reuse the X tab.

## 1. Hard rules (summary, memory files have full detail)

- Never engage @scaling_shields. Never reply to @LukasMaxenn. Never touch DMs. Never name clients. Larsen is off-limits.
- Never lie. No invented stories, numbers, locations, personal facts. Voice (23yo Florida guy) is a style only.
- Every cold email statement must match how WE work (CONTEXT_Campaign.md + what Kasper says). Our step 1 often IS a call ask with a reason; "can I send over more info?" is the step 3 ask-less lever. No absolutes that contradict our sequences. Kasper wins over the playbook.
- No em/en dashes, no colons, no bold/bullets in posts, no "Most people"/"Everyone" openers, no quotable closer, no "not X, it's Y", no lists of three, max one slang word, contractions always. Name one specific thing from their post.
- Comment targets: 5K to 250K followers (check profile every time). Topics ~80% cold email, ~20% X growth. On X growth be humble: we just started on X, ask/react, never advise.
- Skip promo waves (Gigi, ListKit, ElevenAgents, Treg), giveaways, politics, crypto, bots.
- Different person each comment within a run. Don't comment on someone already commented on today (check the run log). Never argue more than one reply deep. Never reply to the same person over and over.
- If someone calls a post AI, do not reply. Kasper handles it.

## 2. Commands

### "reply"
1. Open x.com/notifications (All tab), read the latest ~15 cells.
2. LIKE every reply to Kasper (auto-like rule), spaced ~20-40s, including ones you don't answer.
3. ANSWER only replies that ask something, add something to respond to, or invite a joke back. Never answer pure agreement/closers ("That's true", "yes", "exactly", "haha nice", "GL!").
4. Match their length and energy. Post directly (Kasper approved direct posting).
5. Log the run in `project_x_reply_routine.md`.

### "comment" (default: 8 to 10 over ~2h) / "N comments in M minutes"
- Explicit window overrides the default. Spread evenly with random gaps, never bursts. Check the clock (`TZ=Europe/Copenhagen date +%H:%M`) before each comment.
- Between EVERY comment: check notifications, like + answer per "reply" rules.
- Finding posts (keyword search alone misses most good posts): use author-list searches. Handles live in `project_x_comment_routine.md` ("Best way to find posts"). Query: `(from:a OR from:b ... ~14 handles) since:<today> -filter:replies`, Latest tab. Also: keyword search with min_faves 8+ (Top), Kasper's For You tab. Then check follower count on each hit.
- Spacing between comments: background `sleep N` (run_in_background), end the turn, continue on the notification.
- End every round with a full "reply" run. Log the round in `project_x_comment_routine.md`.

### "post"
- Results posts are paused. "post" = 1 quote tweet + 1 regular post. Publish/schedule per `project_x_post_rotation.md` (default: schedule in X's composer, US-awake times, avoid slots already scheduled).
- Check every claim against CONTEXT_Campaign.md and the topics-used list. Never repeat a used topic.
- End with a "reply" run. Update the cycle state line in `project_x_post_rotation.md`.

### "schedule next week"
Draft 7 posts, show Kasper, schedule only after approval.

### "rewrite the scheduled posts" / checking scheduled posts
Open x.com/compose/post/unsent/scheduled, read every post in full, fix anything that breaks the rules or contradicts how we work.

## 3. Mechanics (tested)

**Post a reply/comment**
```js
window.__t="<text>"; location.href='https://x.com/intent/post?in_reply_to=<ID>&text='+encodeURIComponent(window.__t); 1
// wait 5s, then:
const ta=document.querySelector('[role=dialog] [data-testid=tweetTextarea_0]'); const ok=ta&&ta.innerText.startsWith('<prefix>'); if(ok){document.querySelector('[role=dialog] [data-testid=tweetButton]').click()} ok
```
Verify on x.com/KasperZacho_/with_replies. If "There's a new version of this post": get the new ID from the author's profile. Use navigate force:true to pass "Leave site?".

**Like a reply**: on the reply's status page, find the article containing a time-link to `/status/<ID>`, click its `[data-testid=like]` (if `[data-testid=unlike]` exists it's already liked).

**Follower count**: profile page, `document.querySelector('a[href$="/verified_followers"], a[href$="/followers"]').innerText`.

**Notifications scrape**: `[data-testid=cellInnerDiv]` on x.com/notifications, strip URLs and `?=&%` from text (otherwise output is BLOCKED).

**New post / schedule**: navigate force:true to x.com/compose/post, focus `[role=dialog] [data-testid=tweetTextarea_0]`, paste via `ClipboardEvent('paste')` with a DataTransfer (into an EMPTY editor only). Schedule: `find` "Schedule post button", set hour/minute selects with form_input, Confirm, check "Will send on ...", click the button, verify in /compose/post/unsent/scheduled.

**Edit a scheduled post**: click it in the scheduled list, click the editor, cmd+a, Delete, type the text with a leading "x", then put the JS caret after the first char and BackSpace (first typed char sometimes gets swallowed; pasting over existing text garbles it). Read the FULL editor text before saving, then click the button.

**Batches**: keep each browser_batch under ~60s (long batches time out).

# 2026-07-19 — Realtime chat: the session-activity feed

## What happened

Chad reported three realtime symptoms: Telegram replies invisible until reload, a duplicated tab
stale and dead, and a rare "the response starts again" glitch. One investigation found they were
all the same architectural gap plus one rendering bug.

## Root causes

1. **No server→UI push existed at all.** Realtime lived only inside the HTTP response of the tab
   that started a turn. Channel turns (`runGlobalRootTurn`), other tabs' turns, and schedule fires
   mutated threads invisibly. The code knew: three separate comments said "there is no server
   push".
2. **The liveness poll only armed for delegations** — a direct root answer (every plain Telegram
   exchange) never tripped it.
3. **ThreadStream had no overlay/history dedupe** while assistant rows persist *per text chunk* —
   so any mid-turn refetch (the delegation poll, the settle refetch racing overlay teardown)
   rendered the same response twice. That was the "starts responding again" report.
4. Bonus, named not fixed away: the per-user root-turn lock quietly queues a web turn behind an
   invisible Telegram turn — the "timeout". It's now visible instead of silent.

## The shape of the fix

One mechanism: `GET /activity/stream`, a per-user SSE **session-activity feed**
(turn-started/updated/ended + origin), fed by all four turn producers, consumed once per app
(AppShell). Listeners don't mirror tokens — they arm the *existing* 4s thread poll while a
background turn runs in their scope (rows persist per chunk, so polled text is near-live) and
settle by invalidation at turn boundaries. `SessionActivityFeed` replays the in-flight snapshot on
subscribe, which is what makes a mid-turn duplicated tab work.

## Learnings

- **Snapshot-on-subscribe is the difference between a broadcaster and a liveness feed.** The
  trace broadcaster could stay replay-free because settled rows cover attach gaps; a liveness
  feed cannot — a subscriber arriving mid-turn must learn the turn exists.
- **begin()/end() pairs must hug the try.** The reviewer caught composition calls between
  `activityFeed.begin()` and the `try/finally` — a throw there leaks a process-lifetime zombie
  turn that every future subscriber replays. Announce-style registries make leaked handles
  *louder* than leaked timers: they broadcast forever.
- **Per-chunk row persistence is a gift.** Because `appendToChatMessageBody` runs per delta,
  poll-based liveness gives near-live text with zero new streaming machinery. Token mirroring in
  other tabs stays a cheap later upgrade (the trace-observe pattern).
- **The dedupe needed the model, not the view, to grow.** One `assistantMessageId` wasn't enough
  — a turn spans several assistant messages (text → tool → text), so ActiveTurnView now tracks
  `assistantMessageIds` including tool parents.
- Swept while here: the root route test harness silently lacked `askWaiters` — every streamed
  root test threw a swallowed TypeError into hono's streaming error path.

## Verification

Gate GREEN 498f/2597t (from 492/2573). Reviewer: 1 must-fix (folded), 2 should-fix tests (added),
3 nits (1 folded, 2 recorded). Chad's live smoke pending: Telegram → open app, duplicated tab,
web-turn-during-Telegram-turn banner.

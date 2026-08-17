# Live streams — the per-origin socket budget (note for a follow-up session)

*Written 2026-08-18 after Kafi's continuity smokes. The "app is frozen / engine stuck / blank
second tab" was never the engine — see the two causes below. The first is fixed; the rest of
this note is what a follow-up session can pick up.*

## What happened (verified)

- The API answered `curl` in milliseconds throughout (`/health`, `/continuing`, the 300 KB
  chain transcript in 19 ms). The DB shows every server-side step landed: checkpoint → swap
  (65 s) → continuation → `ask_user` (answered 3.5 min later, the tool resumed the same second)
  → the task finished.
- **Cause 1 — the browser's HTTP/1.1 cap: 6 connections per origin, shared by every tab.** Each
  Vynel tab on `localhost:18894` (vite) or the API origin held: the activity feed
  (`/activity/stream`), the voice link (`/voice/events`), a STANDING watch per displayed thread
  (`/sessions/:id/stream`, one per registry entry, always attached), and — while a turn runs — the
  turn's own POST stream (held longer since Slice 4/5: patching → continuing rides one stream).
  Two tabs during a turn ⇒ 7 sockets ⇒ every poll queues (DevTools waterfall: light
  "queueing/stalled" bars; the Timing tab says *Stalled*). Looks exactly like a dead backend.
- **Cause 2 — dev-stack restarts.** `local-api` and `voice` run under `node --watch`: any save
  to a file they import restarts them mid-turn (SSE cut, "engine stuck" for seconds). Kafi also
  restarts `pnpm dev` when it looks stuck (all node processes re-created; a probe sees ~20 s of no
  answers). Rule for the AI pair: never edit watched source files while he is live-testing.

## What shipped (`f57cb34`)

- **The attach gate** in `apps/local-web/src/stores/live-turn-registry.ts`: a session watch
  holds a socket ONLY while `activity.serverTurnForSession(id)` reports a turn on that session
  AND at least one subscriber isn't suppressed by its own overlay (`isSuppressed` rides
  `registry.subscribe`, passed by `use-watched-turn`). Idle attaches are aborted when the gate
  closes; a mid-turn attach settles first; the loop re-attaches only for the feed's next turn —
  the server's stated contract ("the activity feed drives the UI's attach lifecycle"). Late
  attaches still seed from the persisted rows. Diagnostics: `registry.attachedCount`.
- Per tab: idle 4 → 2 sockets; working 5 → 3. Two tabs during a turn now fit under the cap.
- Also in that commit: `liveClockStartMs` (the patching / continuing chip counts its own phase)
  and the session thread's "Needs input" pill (`SessionThreadView` → `ThreadStream`).

## Left for a follow-up (not built — pick by need)

1. **Share the activity feed across tabs** — a `SharedWorker` (WebView2 + Chromium both support
   it) owning the one `/activity/stream` and fanning frames to tabs via `BroadcastChannel`; a
   leader-election fallback for browsers without SharedWorker. Saves 1 socket per extra tab.
2. **Lazy `/voice/events`** — connect the EventSource only when the voice UI is mounted or the
   daemon is known reachable (today it retries forever in every tab even with no daemon).
   Saves 1 per tab.
3. **Multiplex the watches** — one `/live` SSE per tab carrying subscribe/unsubscribe for many
   sessions/traces (a server change: the broadcaster already keys channels; the route would take
   a dynamic set). Only worth it if the app ever shows many live threads at once.
4. **HTTP/2** would lift the cap entirely but needs TLS in browsers — not for a local dev origin.

## How to verify a report of "frozen"

1. `curl -s -o /dev/null -w "%{http_code} %{time_total}\n" http://127.0.0.1:18892/health` from
   the same machine — ms means the API is fine.
2. Read the dev DB timeline (`chat_messages` / `chat_tool_calls` / `ask_requests`) before touching
   code — the swap, the ask, the continuation all leave rows.
3. DevTools → Network → click a pending request → **Timing**: `Stalled/Queueing` = the socket cap.
4. Count sockets: filter the Network tab by `stream` / `events` per tab.

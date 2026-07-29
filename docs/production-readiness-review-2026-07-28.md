# Production-readiness review — sessions & chat pipeline (2026-07-28, overnight)

Chad's 8-point pre-release checklist, worked overnight. **Everything below is uncommitted on
`main`** — smoke-test, then commit (suggested message at the bottom). Gate: `pnpm test` green
(3,30x tests) after the run recorded in this doc.

## TL;DR

| # | Item | Outcome |
|---|------|---------|
| 1 | Loader on session/chat load | **FIXED** — `ThreadSkeleton` shimmer + pending/error gates on all 3 surfaces |
| 2 | Duplicate first message | **ROOT-CAUSED + FIXED** — it was two *real* turns (reload-resend after a hang), not a render bug |
| 3 | Stuck send + message lost | **FIXED** (4 server fixes + client drop detection) |
| 4 | Elapsed time / progress / timestamps | **SHIPPED** — message timestamps, live turn timer, live per-tool timer |
| 5 | Schedule failure never reaches chat | **FIXED** — `schedule.run-failed` event → global-root report delivery + watchable |
| 6 | Background tasks (long scripts, `pnpm dev`, notify) | **AUDITED — ~35% real; gaps documented below** |
| 7 | Monitor tool vs goal | **AUDITED — delivery half is solid, watch half is a different primitive; gaps below** |
| 8 | Pipelines (session→session, task report-back) | **AUDITED — 4 real gaps found, listed below** |

Live proof: sent a message through the real app at 11:49 — rendered exactly once, timestamped
"11:49 AM", Claude replied, turn settled clean.

---

## Item 3 + 2 — the stuck send, the lost message, and the "duplicate"

### Root causes found (server)

1. **The user message was persisted LAST, after everything that can hang.** The only insert sat
   behind the SDK subprocess spawn + auth + session-resume validation
   (`run-claude-chat-session.ts` first `await queryInstance.next()` — unbounded, no timeout
   anywhere in the provider package). Resume validation is exactly the extra work an *existing*
   session does — which is why it was always the first message on an existing session that hung,
   and why reload lost the message.
2. **Pre-session errors were silently swallowed.** `consume-session-event-stream.ts`'s
   `session-errored` case only yielded `if (sessionId)` — any failure before `session-started`
   (spawn, auth, resume) produced zero frames. The composer stayed "working" forever.
3. **A thrown stream died as a bare socket close.** `chat-turn.ts` had no catch and no `streamSSE`
   onError — Hono `console.error`'d and closed with no terminal frame.
4. **The client treated a dropped stream as success** and wiped the turn error milliseconds after
   folding it (settle raced the overlay teardown).

### The "2 messages from me" (item 2)

Code-level audit (server + client): **no single send can double-persist** — the server inserts the
user row exactly once per turn (PK'd), and the thread dedupes overlay vs settled rows by id.
The duplicate you saw is the *reload-resend cycle*: a send that hangs (cause above) or parks
behind a busy session **keeps running server-side after you reload** (documented lock-handover
behavior in `session-turn.ts`) — resending then produces two real turns → your message twice.
Fixing the hang fixes the duplicate.

### Fixes shipped

- **Durability-first persist** — a RESUMED turn's user message now persists *before* provider
  startup (`consume-session-event-stream.ts`, wired at all 4 call sites: workspace chat, global
  root, spawned-session delegation, workspace-root delegation). A hung or failed start can no
  longer lose the message; it also fixes the timestamp skew (createdAt used to be "when the SDK
  finished starting", not "when you hit send"). `handle-session-started` skips the insert when the
  row exists (`alreadyPersistedUserMessage`), including the rare mid-start SDK-swap case.
- **90s startup timeout** in the provider (`SESSION_STARTUP_TIMEOUT_MS`, aborts the query, yields
  a typed, actionable `provider_start_timeout` error).
- **Pre-session errors always reach the client** (the `if (sessionId)` gate removed).
- **Guaranteed terminal SSE frames** on all three stream routes (`chat-turn.ts`,
  `session-turn.ts`, `global-root-turn.ts` + new `write-sse-safely.ts`): a thrown turn now emits
  `session-errored` and *every* exit path emits `turn-stream-ended`.
- **Client drop detection** (`use-chat-turn`, `use-session-turn`): a stream that closes with no
  terminal frame is settled as a readable failure, never silent success; the failure text persists
  under the composer (`errorText`) instead of vanishing with the overlay; the settle refetch is
  bounded (8s race) so a hung refetch can't strand the overlay and the send queue.
- **The first-send blind window is gone** — `activeTurn` in GlobalChatView/WorkspaceView now shows
  a fresh turn before `session-created` assigns the id (previously the welcome hero sat on top of
  a live stream).

### Still open (deliberate deferrals)

- **New-session sends** still persist at `session-started` (no session row exists earlier — FK).
  Bounded by the 90s timeout + visible error now; a pre-allocated session row would close it fully.
- **Root-turn lock has no timeout** (`root-turn-lock.ts`) — one wedged root turn queues all later
  root turns (web/channel/voice/schedule). The startup timeout bounds the known wedge cause.
- **chat.\* has no concurrency guard** — two rapid sends on one workspace session run two
  overlapping SDK resumes. Rare from the UI (composer queues), reachable via API.
- **Tab-switch orphan**: switching tabs mid-turn abandons the client stream reader (turn continues
  server-side and lands in history; you just lose the live view). Needs a keep-alive or unmount abort.

## Item 1 — loader

- New `ThreadSkeleton` (packages/ui) — shimmering ghost rows, reduced-motion aware.
- `GlobalChatView` + `WorkspaceView` had **no pending/error state at all** (cold-cache open
  flashed the welcome hero; a failed history read rendered as an empty conversation, silently).
  Both now gate: skeleton while pending → error note on failure → welcome only when truly empty.
- `SessionThreadView`'s plain "Loading…" text upgraded to the same skeleton.

## Item 4 — timestamps, elapsed time, progress

- **Every message row now shows when it was sent** — "11:49 AM" today, "Jul 27 · 03:15 AM"
  earlier (`MessageRow` + `formatMessageTimestamp`; wire already carried `createdAt`).
- **The working chip ticks**: "working · 42s" (turn start stamped on the live view).
- **Running tool calls tick live** ("4s", "1m 12s") Claude-Desktop-style; the settled duration
  stays as before (`ToolCallCard`).
- Real progress while a turn runs was already partially there (tool cards stream in live); the
  missing piece was elapsed time + failure states, both now in.
- *Deferred*: elapsed time on the delegation ProcessingBanner chips and on subagent activity panes
  (wire data exists — `startedAt` is on both — purely a UI add).

## Item 5 — schedule failures now reach chat

Found: a failed run wrote `status='failed'` into `schedule_runs` — a table **no UI reads** — logged
a warn, and returned as if fired. No chat write, no event, nothing. (Worse: failures *before* the
first token left zero artifacts anywhere visible.)

Shipped, house-pattern (outbox + registry, no sibling-leaf import):
- `fire-schedule.ts` catch now co-commits run→failed **+ a `schedule.run-failed` outbox event** in
  one transaction.
- New consumer `consumeScheduleRunFailedEvent` (orchestration) → `enqueueReportDelivery` to the
  **global root** — the failure arrives in your main chat as a compact incoming report
  ("Schedule · Morning brief"), through the same notify-turn engine all reports ride.
- `schedule.run-failed` added to the monitors watchable catalog (arm a monitor on it if you want).
- Caveat: if the failure cause is "provider down", the notify turn itself may fail too — the
  durable failed job row + run row still exist. UI surfacing of run history (below) is the backstop.
- *Deferred*: `SchedulesSection` still shows no last-run status/error and has no "Run now" button —
  the API (`GET /:id/runs`, `fire-now`) already returns everything needed.

## Item 6 — background tasks (audit)

**~35% of the goal is real.** What exists: `packages/apps`' process supervisor is solid — spawns
long-lived commands (`pnpm dev` included), survives the turn, ring-buffers 2000 lines, tree-kills
on stop, kills nothing on Vynel quit without cleanup, emits `app.stopped`/`app.crashed` (with exit
code) into the outbox. Tools: `add_app`/`start_app`/`stop_app`/`get_app_logs`.

**Gaps to close before this matches "Claude Code shell in background":**
1. **No ad-hoc background command.** Every command must first be registered as a named app row
   (`add_app`) — there is no `run_command(background: true)`.
2. **No automatic notify-on-finish.** Claude is only re-invoked if it *remembered to arm a monitor*
   on `app.stopped`/`app.crashed` filtered by appId. Recommended smallest fix: auto-arm a `once`
   monitor for the calling session inside `start_app` — the entire wake pipeline already exists
   and is production-grade.
3. **Logs are in-memory only** (empty after an engine restart) and the wake payload carries the
   exit code but not an output tail — the woken turn must call `get_app_logs`.
4. `packages/tasks` is a to-do checklist, not an executor — despite the name, it contributes
   nothing here ("Phase 1 consumers: NONE" in its own events file).
5. SDK-native backgrounding is deliberately disabled (one-shot turn teardown would orphan it) —
   the supervisor is the right home; don't reopen that door.

## Item 7 — monitor tool (audit)

**Delivery half ≈ 95%, watch half ≈ 20% of the Claude-Code-Monitor goal.** What exists is an
*outbox-event subscription*: 14 allowlisted internal event types, exact-string payload filters,
10s tick, durable + TTL'd + watermarked, and a genuine session re-invocation on match (all three
owner kinds; crash-safe ordering; well-tested). What it is **not**: it cannot run a command, watch
a process/log/file/URL, or match output text (no regex/substring/threshold). It's a different
primitive wearing the same name.

To reach the goal, the missing piece is a **producer**: something that turns "command output
matched X / command exited" into outbox events. The supervisor + a small output-matcher would
close both item 6 and item 7 with the existing wake infra unchanged. Also untested: the 10s
service loop itself (`monitors-service.ts` has no test; every sibling service does).

## Item 8 — inter-session pipelines (audit)

Working end-to-end: `send_message` → queued job → real turn in the target session (FIFO per
target, queued when busy, crash-orphans reaped at boot); reports → workspace primary / global
root render as compact incoming boxes; stop (human HTTP control) with report suppression.

**Real gaps found:**
1. **Session→session report-back misroutes.** A spawned session's report is ALWAYS delivered to
   its grounding workspace primary or the global root — never to the *session* that sent the task
   (`enqueue-report-delivery.ts` hardcodes `targetPrimarySessionId: null`; requester resolution
   ignores the sending session). The sender never learns the outcome.
2. **Child failure reaches only the global root**, and only on its next turn. A workspace primary
   or sibling session that delegated learns nothing when the child fails or is stopped.
3. **No `stop` tool** — the locked create/list/send/stop root tool set is missing stop (it's
   deliberately human-only today; decide if that stays).
4. **Inbound attribution hardcoded** — every task arriving in a spawned session is labeled
   `global-root` ("From Claude") regardless of the real sender; `send_message`'s session target
   also drops workspace provenance its predecessor tool carried.
5. Report-back on child completion is **opt-in by design** (no-harvest lock): a silent child
   delivers nothing. Working as decided, but worth re-confirming for production.
6. Untested: `send_message` → `session:<id>` destination (exactly the hop whose resolution differs).

## Code review (Gate 3)

`code-reviewer` ran over the full diff — verdict: solid pass, architecture invariants clean, one
must-fix + two should-fixes, **all three folded in**:
- MUST-FIX (was real): the early persist made the delegate runners' local `sessionId` stale on a
  mid-turn SDK swap, silently no-op'ing the leaf interrupt/denial-breaker. Fixed: `sessionId`
  follows `session-created` in both runners (+ the GlobalRootDrainSink provenance sibling).
- Should-fix: `format-timestamp` unit tests added.
- Deferred (reviewer + me agree, cosmetic/pre-existing): dedupe the 8s settle constant across the
  two composables; disconnect-aware log level in `chat-turn.ts`; the pre-existing plain-chat
  swap-presentation gap (listed "New session" row without a continuity stamp).

## Verification

- `pnpm test` full gate green (typecheck all + schema/MCP/SDK/port parity + vitest ~3,3xx tests);
  MCP generated files regenerated for the new watchable event.
- New tests: early-persist (resumed + same-session dedupe + pre-session error surfaced),
  schedule-failure event co-commit, run-failed consumer row shape, registry dispatch.
- Live smoke on the running dev app: send → single render → timestamps → clean settle.
- NOT live-tested (needs conditions I can't fake): a genuinely hung provider start (timeout path),
  a schedule failing on the poll tick end-to-end into the root chat, the swap-mid-start case.

## Suggested commit

```
fix(session): stuck sends, lost messages, silent failures + chat UX pass
```
(or split: `fix(schedules): failed runs reach chat`, `fix(chat): durable sends + terminal frames`,
`feat(web): thread loader, timestamps, live elapsed`.)

---

# ROUND 2 (same day, Chad's second list)

## R2-1 · Tab-switch stuck during a running turn — FIXED (core), one follow-up

Root cause (full map in the audit): `RouterView` re-keys per tab with no KeepAlive; the in-flight
turn's reader survived in a closure — draining from a dead view, **retargeting the old tab's
shell from beyond the grave** and firing global invalidation storms; meanwhile the remounted view
lost its `isStreaming` flag, so it classified its OWN still-running turn as a background turn
(banner + 4s polls, no live stream, no Stop — the "stuck" you saw).

Fixed: both turn engines abort their reader on scope dispose (client-side only — the server turn
runs to completion and persists; verified safe against Hono internals) and a disposed instance
skips the settle tail (no dead-view invalidations/writes). After a switch, the running turn now
correctly shows as a live background turn (banner + live 4s poll) and settles cleanly.

*Follow-up (designed, not built):* re-attach the remounted view to the running turn over the
existing `GET /sessions/:id/stream` watch channel — restores live tokens + Stop after a switch.
The audit names the exact wiring (`use-activity-monitor.ts` is the pattern to copy).

## R2-2 · Streaming latency + missed frames — audited; 6 fixes landed

Verdicts: transport is clean (no compression, no batching, chunked SSE straight through); the
dominant latency cost was **a synchronous SQLite commit per streamed token** (better-sqlite3 +
`synchronous=FULL` default = an fsync per text delta, stalling the whole event loop).

Landed:
- `PRAGMA synchronous = NORMAL` (safe WAL pairing) + `busy_timeout = 5000` in the db kernel —
  removes the per-token fsync.
- **Watch-channel key bug** (introduced by my own round-1 fix, caught by the audit): a
  pre-session error's empty sessionId could lock a turn's watch channel onto a garbage key —
  guarded.
- Heartbeat on `GET /sessions/:id/stream` (half-open idle watchers were undetectable).
- Client reader hardening: malformed frame is dropped instead of killing the stream; final
  TextDecoder flush (truncated multi-byte at EOF).

*Deferred (documented, ranked in the audit):* per-delta DB append coalescing (biggest absolute
win, moderate effort); replay ring-buffer on the watch channel (attach-after-start misses the turn
head); backpressure on watcher writes.

## R2-3 · Error retry + parent notification — BUILT (the priority item)

Audit verdict first: **zero retry existed anywhere**; `isRecoverable` was write-only; a failed
delegation reached only the global root, pull-only, on its NEXT turn; a failed report-delivery row
(the only copy of a child's result) became permanently invisible.

Landed (schema 0023 + the channels-outbound retry shape, applied to delegation):
- `delegation_jobs` gains `attemptCount` / `nextAttemptAt` / `errorCode` (pure additive ALTER) +
  a ready index; the claim now gates on the backoff deadline (NULL = due, legacy-safe).
- `requeueDelegationJob` + a failure classifier (`classify-turn-failure.ts`): transient shapes
  (rate limit, overloaded, 429/5xx, network resets, provider start timeout) requeue with backoff —
  30s then 5m, max 3 attempts. Stops, timeouts, and bookkeeping throws NEVER retry (timeout
  retry would put two writers on one session — documented).
- Same treatment for **report-delivery** jobs — a child's report can no longer be silently lost to
  a transient notify-turn failure.
- **Give-up push:** a terminally failed task job now enqueues a real report delivery to the global
  root — "task X failed after N attempts: <error> — re-send to retry" — a notify turn the moment
  it happens, not a context block whenever the user next speaks. Marked surfaced so the old pull
  net doesn't repeat it. Anti-cascade: a failed report-delivery never spawns another delivery.

*Still open:* workspace/sibling requesters still aren't individually notified (the round-1
misroute gap — requester resolution collapses to the global root); the provider still stamps
`isRecoverable: false` on all SDK result errors (classifier compensates by pattern; a real
taxonomy belongs in `run-claude-chat-session.ts`).

## R2-4 · Voice overlay at launch — FIXED

The overlay is the separate `jarvis` Tauri window; its Rust builder was missing `.visible(false)`
(Tauri defaults visible), so it painted on every launch — no wake involved ("Wake daemon offline"
was the tell). Fixed (+ `skip_taskbar(true)` for the stray taskbar entry). Wake-launch still works:
the daemon replays the undelivered wake and JarvisView reveals itself. `cargo check` green.

## R2-5 · Doubled window controls — FIXED (two defects)

(a) The main window never disabled native decorations → Windows chrome over the app's own title
bar. (b) The custom buttons WERE wired but every window IPC was ACL-denied — no Tauri capability
listed the `main` window at all, and the rejections were silently swallowed. Fixed atomically:
`.decorations(false)` + new `capabilities/main-window.json` (minimize/toggle-maximize/is-maximized/
close/start-dragging/core:default). This also un-breaks window dragging, double-click-maximize,
Ctrl+Q, and the Vynel ▸ Quit menu item. Needs a packaged-app smoke test.

## R2-6 · Jarvis home dashboard — PLANNED, then SLICES 1+2 BUILT

Full design in `docs/jarvis-home-dashboard-plan.md` (concept, all data sources verified, animation
language, taste guardrails, 6 slices). On Chad's go, **slices 1 and 2 shipped the same session**:

- **Slice 1 — "Right now" band (the centerpiece).** New `turn-narration-store` (pure fold over the
  activity feed's step events + test), wired into the one app-wide feed subscription beside the
  existing folds. `LiveNowBand` + `LiveSessionCard` on Home: one gold-breathing card per in-flight
  turn, labeled by workspace persona ("Noah · Invoices") or "Assistant thread", origin note
  ("via Telegram" / "from a schedule"), live 1s elapsed ticker, and a crossfading plain-words
  narration line (800ms coalesce; `displayToolName` + small-argument extraction, one line, clamped
  — screen-share safe). Status line counts working sessions. Reduced-motion honored throughout.
- **Slice 2 — task celebration.** Tasks extracted to `TasksCard` with the completion celebration:
  a task seen open that completes while you watch draws its green check (SVG stroke), washes, and
  FLIP-glides into the delivered shelf (pure diff guard + test — never celebrates on initial load
  or refetch replay). Home's overview polls at 5s only while a turn runs.
- **Verified live** on the running dev app: band appears on a real turn ("Assistant thread ·
  thinking… · ticking elapsed"), status line switches to "One session working right now", card
  exits cleanly at turn end back to "All quiet". The tool-step narration line itself wasn't caught
  live (the test turn's single `ls` settled between polls) — the fold is unit-tested and rides the
  same feed events the desktop overlay consumes in production.
- **Remaining slices (3-6, planned not built):** usage rings, schedules/approvals tile polish,
  weather widget, news widget + feed proxy.

## Recommended next moves (ranked)

1. Auto-arm the once-monitor in `start_app` → closes notify-on-finish (small, high value).
2. SchedulesSection last-run status + "Run now" (API already serves it).
3. Route session→session reports to the sending session (pipelines gap 1) + fix attribution (gap 4).
4. `run_command` background tool over the existing supervisor (item 6 gap 1) + output-matcher
   events (item 7).
5. Root-turn lock timeout; pre-allocated session row for new-session sends.

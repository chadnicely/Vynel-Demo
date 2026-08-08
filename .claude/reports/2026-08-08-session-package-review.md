# Session package review + live-tracking report (2026-08-08)

**Scope:** full verification of the persona-sessions arc (A1–A10 backend + B1–B8 frontend, commits
`fda50dc^..a7f16d0`) + a whole-package adversarial review of the session backbone
(`packages/session`, `packages/orchestration` lifecycle, data/API surface, and the realtime
tracking chain) + the what/how/where live-tracking report per view. Four independent reviewers +
three wh documenters; every MUST-FIX below was re-verified in the code by the main session unless
marked otherwise. **No fixes applied, nothing committed — punch-list awaiting Chad's call.**

## TL;DR

Mechanically green: typecheck 47/47 turbo tasks; **1,881 targeted tests green**
(576 session/orchestration/chat/contracts · 605 local-web · 700 local-api/ui). Full `pnpm test`
gate deliberately NOT auto-run (CPU rule) — run it before/with the fix arc.

The serial paths of the backbone are genuinely solid (locks, get-or-create races, swap co-commit,
A5 checklist, A9 parity, userId scoping, one-fold vocabulary, refcounted registry, durable seed).
The whole-package pass found **9 real must-fix bugs** the per-diff reviews structurally missed —
five in the delivery/continuity guarantees, four in the realtime chain. Three of them together
explain "good functional except realtime tracking": **delegated turns never publish narration
steps**, **delivery jobs ghost into the persona-card roster**, and **the feed's snapshot replay
blanks narration after any refresh**.

## MUST-FIX punch-list (ranked)

Data-loss / corruption class:

1. **A restart permanently loses a claimed report-delivery.** `failOrphanedClaimedDelegations`
   (`packages/orchestration/src/repositories/delegation-jobs.ts:513-525`) flips EVERY claimed row
   to failed + `surfacedToRootAt`; boot skips delivery kinds for pushes
   (`apps/local-api/src/services/delegation-service.ts:113-114` — correct anti-cascade) but never
   requeues the delivery, and the catch-up net (`delegation-jobs.ts:391`) + `list_background_runs`
   (`:441`) filter to task rows. The child's job says "reported"; the requester never hears the
   only copy of the result. Fix: boot-requeue orphaned claimed `report-delivery` rows
   (status→pending; at boot nothing is running so re-delivery is safe/at-least-once);
   `update-delivery` stays terminal-drop. *(verified)*

2. **The failure path ignores `reportedAt` → duplicate report or success-then-"failed".**
   `settleFailedDelegationAttempt` (`packages/session/src/delegation/settle-failed-delegation-attempt.ts:34-57`)
   and `requeueIfRecoverable` (`classify-turn-failure.ts:36-59`) never re-read the row. A child
   that sent its final report and THEN died on a transient error re-runs the whole task (second
   report), or non-recoverably pushes "the task failed" after the success report arrived. Fix:
   fresh-read `reportedAt` at the top of settle; if stamped, record the failure on the row but
   skip both requeue and give-up push. *(verified)*

3. **Workspace-primary single-writer hole on the web chat path.** The continue-mode branch of
   `streamChatTurn` (`apps/local-api/src/streams/chat-turn.ts:129-141`) resolves the primary and
   resumes its SDK session with NO `SessionTargetLocks` acquisition — while the delegation pool
   keys on the workspace id and the spawned direct-send route awaits the lock
   (`session-turn.ts:121-124`). A user turn + a delegated run (or two tabs) can concurrently
   resume the same SDK session; if both cross the pressure threshold, `repointPrimarySession` has
   no CAS on `fromSdkSessionId` → double-bridge, forked chain, orphaned hidden segment. Fix:
   acquire the workspace-id lock around resolve→turn→continuity in the continue branch (mirror
   session-turn.ts incl. re-read-head-after-wait); belt-and-braces CAS param on
   `repointPrimarySession`. Pre-existing before the arc, but delegations made the collision
   real-world. *(verified: missing lock; fork mechanics per reviewer)*

4. **A mid-turn SDK session swap creates a chain-orphaned segment — the global root loses its
   visible history on reload.** The missing-row branch of `handleSessionStarted`
   (`packages/chat/src/turn-consumption/handle-session-started.ts:79-105`) stamps no
   `continuedFromSessionId` and emits no `session.swapped` (only the boundary bridge emits it —
   `bridge-primary-session.ts:110`, verified sole emitter). `resolveGlobalRootTranscript`
   (`resolve-global-root-transcript.ts:90-130`) derives the chain ONLY from swap events → after a
   provider-initiated mid-turn swap (auto-compaction on the long-lived brain), reload shows only
   post-swap rows (data intact, unreachable). Side effects on other scopes: detached overview
   heads (B6 follow can't engage), workspace swap row gets default title ("New session" stray),
   spawned swap row defaults to scope 'global' (phantom "Assistant" entry); only
   `delegate-to-agent-session` passes scope. Fix: in the missing-row branch stamp
   `continuedFromSessionId` + inherit scope/visibility from the resumed row; make the transcript
   walk the row chain (or emit the swap event at the link site). *(verified all three links)*

5. **Monitor watermark can skip events forever.** `run-monitor-tick.ts:92-110` reads the outbox
   window with the shared default cap (200, max 500 — `db/repositories/_shared/outbox.ts:104`)
   and advances the watermark to `now` unconditionally. >200 subscribed-type events in one 10s
   window → the unread tail is never scanned; a matching event = a silently lost wake. Fix: page
   the read until exhausted, or on a full page advance only to the last read event's createdAt.
   *(verified)*

Realtime-tracking class (the "except realtime tracking" complaint):

6. **Delegated turns publish no narration steps — persona cards narrate nothing on their primary
   path.** `publishTurnActivityStep` is called only by chat-turn, the two global-root sinks, and
   schedule fires (verified by grep). The delegation tick, `run-agent-run-job`, the
   workspace-side branch of `run-report-delivery-tick`, and `streams/session-turn.ts` begin/end
   on the feed but never tap steps — so B5 cards + B7 roster rows for exactly the delegated tasks
   they were built for show state/label/elapsed with a permanently empty narration line (steps
   ride only the trace/session channels). The card test seeds the narration store directly
   (`use-live-delegation-cards.test.ts:108`) — the accentVar fixture lesson repeated. Fix: tap
   `publishTurnActivityStep(activityHandle, event)` in the observer seam of the three runners +
   session-turn's loop; add one producer-level test asserting a delegated run emits
   `turn-tool-started` on the feed. *(verified — found independently by three agents)*

7. **Delivery jobs leak into the in-flight roster as ghost "task" cards — and Stop kills the
   delivery.** `listInFlightDelegationsForUser` (`delegation-jobs.ts:402-417`) filters status
   only, never `jobKind`. The moment a child acks, the parent thread + Background roster grow a
   second persona card whose label is the ack SENTENCE (delivery `taskText` = message body),
   queued→working, with working Watch/Stop — and Stop fails the delivery (an update then drops
   terminally = spoken-lifecycle message loss). Violates the A5 rule "update rows must never
   render as tasks" — this was the one jobKind reader the checklist missed. Fix: add the
   work-kind predicate (`isWorkJobKind` one-home — currently unused in production anywhere) +
   an exclusion test. *(verified)*

8. **The feed's snapshot replay can be an unrenderable settle frame → blank narration after every
   refresh/reconnect landing between tools.** `session-activity-feed.ts:143-147` overwrites the
   stored last step with settle/approval frames; `:169-173` replays that frame; a settle carries
   no `toolName` and the narration fold drops settle-without-start
   (`turn-narration-store.ts:54-63`). F5 / roster open / SSE reconnect (which also resets the
   stores) during thinking/text — most of a turn's wall-clock — narrates a generic "Working…"
   with an empty ring. Its own test pins the useless replay
   (`session-activity-feed.test.ts:112-115`). Fix: track the last `turn-tool-started` frame per
   turn and replay started(+its settle); extend the test to assert a renderable replay.
   *(reviewer-verified; mechanism corroborated across agents)*

9. **The session pane's header dot is gold whenever the SSE is merely connected.**
   `ActivityMonitorPanel.vue:147-152` keys session-node liveness on `isStreaming` =
   attach-success (`live-turn-registry.ts:141`), and an idle session's stream connects and waits
   forever — so any idle session opened in the pane glows "live", devaluing the presence signal
   exactly where users go to check it. Fix: key on
   `activity.serverTurnForSession(sessionId) !== null || watchedView !== null` (the SessionsView
   row dot already does this). *(reviewer-verified, simple mechanism)*

## SHOULD-FIX (grouped, keep with the arc)

Delivery/lifecycle: settle-failure + boot reap-then-push are non-transactional (wrap in
`withTransaction`); catch-up net excludes `agent-run` (widen to `isWorkJobKind` — also fixes
settle's "stays in the net" fallback claim); stale "report delivery enqueued" log line in the
tick's completed branch (:652-655); timeout policy divergence (`run-agent-run-job` calls
`abandonParked`, the two ticks deliberately don't — align on the ticks' policy);
`runAgentRunJob`'s completed co-commit lacks the fall-open guard the task tick pins (a throw
inside the transaction flips a COMPLETED turn to failed).

Continuity/core: `markDelegationsSurfacedToRoot` runs at turn-BUILD (`run-global-root-turn-core.ts:173-192`)
— a provider startup failure permanently drops those report texts from the root's awareness (move
the mark after the first successful stream event); `onCompaction` not wired on the global-root
core (the brain never emits `session.compacted`); no wall-clock bound on root turns (a
never-terminating provider stream wedges the per-user root-turn-lock chain until restart);
`FilesystemSessionStore` sessionId not validated → path traversal (dormant, no production caller).

Data/API: `ChatSessionScopeSchema` omits `'spawned'` (`routes/chat/schemas.ts:121`) — OpenAPI/SDK
lie on a shipping response (derive the enum from the row union); `deliveredTo` for session targets
can read "Continued conversation" after a swap (route through `resolveSpawnedSessionName` /
persona resolution); delivered rows stamp `sourceKind:'workspace-manager'` even for colleagues
(`'agent'` exists in the vocabulary — widen while fresh).

Realtime chain: seed the session watch at attach when the feed says a turn runs (mid-turn attach
currently renders nothing until the NEXT chat event — long silent tools = frozen pane, compounded
when the feed is mid-reconnect because the 4s fallback poll gates on `serverTurns`); surface feed
health ("live updates reconnecting" — today an outage is invisible and recurs on every
sleep/wake); trace stream has no heartbeat + panel hides its errorText; `session-activity-stream.ts:14`
JSON.parse without try/catch (one corrupt frame = full feed reset); `active-turn-view.ts` fold
lacks a `default` arm (unknown event kind wipes the fold via the registry); monogram of
persona-first labels renders "N·" (`workspace-monogram.ts` — strip the "·" token); unclaimed
direct-send turns group under "Assistant" in the roster (stamp `personaName` at the session-turn
producer); nothing invalidates `["delegations","in-flight"]` on send_message completion (cards
feel ≤4s laggy — cheap instant-card invalidation available).

## Notes (recorded, not fixes)

Cross-reporter update coalesce overwrite on one thread (within the recorded design key);
`RECOVERABLE_PATTERNS` `\b5\d{2}\b` overbroad (bounded by 3 attempts; amplifies must-fix 2 today);
timed-out zombie turns lose Stop-reach + feed visibility (accepted "stop waiting, not the turn");
global-delivery approvals don't suspend the 600s budget; swap-chain reconstruction windowed at 200
outbox events + assumes outbox immortality; overview sort comparator returns -1 on ties; purge
callers for `session_turns`/hard-delete not yet landed (documented follow-ups); stale comments
(`delegate-to-leaf-session.ts` consumer, `session-continuity-events.ts` scope list,
`concurrent-delegations.md` begin() claim, routing test-harness "not mounted" comment);
`run-global-root-turn-core.ts` at 303 lines (split on next touch); mid-turn-swap live tail stays
on the OLD session channel key (adjacent to the accepted two-streams residual — name it in a
comment). Monitor tick: gone-owner spawned wake throws every 10s until expiry (add terminal
branch); workspace-owner wake skips the explicit userId check the spawned branch does.

Wire↔fold parity is otherwise clean (7 activity kinds, 18 chat kinds, one fold); B8 accent
convention holds at every consumer; crossfade CSS confirmed global; sourceLabel LAST-segment parse
confirmed in its one home; F5/restart durable rebuild genuinely works (seed + reap + honest
failure deliveries); no cross-tenant leak found anywhere (userId scoping PASS on every repo read
+ route; caller identity server-stamped only).

## Live tracking — what shows on each view today

Full documents (grounded in code, per-view): `wh-what-live-tracking.md` (concept/behavior),
`wh-how-live-tracking.md` (boundary dataflow + Mermaid), `wh-where-live-tracking.md` (file map)
in this session's scratchpad — worth promoting into `.claude/docs/` if wanted.

**The spine (HOW):** every turn producer (8 call sites) announces on ONE per-user
`SessionActivityFeed` (`begin/steps/end`), mirrored durably into `session_turns` (boot-reaped);
token streams tee onto per-source channels (`session:<id>` always, `trace:<partialSessionId>` for
delegations) served as SSE; the client holds one app-lifetime `/activity/stream` fold into three
stores (presence map · narration ring ≤5 · desktop), a refcounted live-turn registry multiplexes
watch SSEs (sessions re-attach across turns; traces one-attach-per-run), and two polls complete
the picture (`/root/delegations` 4s roster; `/activity/running` 5s durable seed, roster-gated,
stream-wins). Persona cards never open SSEs — they compose poll × presence × narration, matched
in ONE home (`delegation-turn-pairing.ts`, key `partialSessionId`, row key falls back
positionally; threadId matches the acked badge excluding `'global-root'` rows).

**Global view** (global thread + Home + title bar): persona-card rail at the thread's live edge —
one card per in-flight task, FULL creator roster, cap 4 + "+N more running" → Background; each
card = avatar/monogram + accent, queued/working, acked tag, narration line + recent steps,
elapsed, Watch/Stop (keyless jobs hide both); LiveTurn overlay for the displayed session's own
turn; watch chips on settled rows pulse gold while their delegation runs; ProcessingBanner shows
only the non-delegation origin note ("Replying on Telegram…"); Home's LiveNowBand (one card per
RUNNING turn, gold breathing edge, origin note) + "See all"; title-bar presence pair = button
opening the Background overview (gold live / amber approvals). Gaps today: queued-only work
invisible on Home + the dot (running-turns keyed); delegated cards narrate BLANK (must-fix 6);
ghost delivery cards after every ack (must-fix 7).

**Workspace view** (a room's thread): same skeleton scoped by the rule "this room cards the tasks
targeting IT" (`onlyWorkspaceId`); the full roster stays global; chips stay unfiltered (rows this
thread SENT); acked badge ignores the parent's own routed-task stamp (the `'global-root'`
exclusion matters most here); "<manager> is working…" banner for feed turns in this workspace the
thread isn't rendering; 4s detail poll while work runs here so routed rows land near-live.

**Agent view** (two readings, both live-tracked): (a) in-turn SDK subagents — every Agent tool
card gets a Watch chip → the panel's AgentFocusView, which rides its PARENT's channel
(trace or session, keyed `toolUseId`), live while running, settled fields after, Back walks
Trace→Session→Agent; (b) agent COLLEAGUES — mention runs produce ordinary persona cards +
acked/updates/report rows in the requesting thread, a working dot on their Sessions-panel row
(workspace scope), their own Background-roster group; opening one is VIEW-ONLY ("@mention them in
chat" — direct-send deferral recorded). Gaps: GLOBAL colleagues invisible in the panel's global
list; idle colleagues have zero presence anywhere; mention runs announce workspace-scoped while
task-branch runs on the same colleague announce global (recorded inconsistency).

**Session view** (Sessions panel · open thread · live pane · Background overview): panel rows
carry a working dot (feed turn matched across the whole continuation chain) + 5s overview poll
while anything runs; an open session is a REAL chat — chain-head follow with the "conversation
continued" note (deliberately-opened earlier parts stay put), composer for spawned heads with
"→ <persona>" destination + mid-turn queued sends, watched overlay for turns it didn't start
(re-attaches across turns) + 4s fallback poll; the LiveSessionPane hosts the same component
inside the monitor panel (chips clicked inside STACK; Back walks the pipeline); the Background
overview is the panel's base node — everything running/queued grouped by working identity
(colleague/spawned → workspace persona → standalone turns), durable-seeded so F5 mid-delegation
rebuilds truthfully, Watch/Stop per row, honest "Nothing running" empty state. Gaps: mid-turn
attach renders nothing until the next event (long silent tools = still page); pane header dot
gold while merely connected (must-fix 9); post-swap live tail stays on the old channel key.

## Why realtime feels dead today (ranked, consolidated)

1. Delegated tasks never narrate (must-fix 6) — the flagship cards show only label + elapsed.
2. Any refresh/reconnect between tools blanks narration app-wide (must-fix 8; SSE drops also
   reset the rings, and sleep/wake makes this daily).
3. Ghost delivery cards make the live edge read wrong/noisy right when the lifecycle speaks
   (must-fix 7).
4. Mid-turn attach on a session shows nothing during long tools; a feed outage disables the
   fallback poll too (should-fix).
5. The pane's always-gold dot teaches users the live signal means nothing (must-fix 9).
6. A dead feed is invisible — no "reconnecting" hint anywhere (should-fix).
7. Latency floor: cards appear ≤4s after delegating (poll cadence) — fine, but an instant
   invalidation on send_message would make it feel immediate (note).

## Recommended next arc (pending Chad's okay)

Order: 6+7+8 first (one "realtime narrates honestly" slice — they're small, adjacent, and kill
the felt deadness), then 1+2 (delivery guarantees — the data-loss pair), then 3 (workspace lock),
4 (mid-turn swap chain repair), 5 (monitor paging), 9 + the should-fix sweep behind them. Every
fix ships its regression test (the arc's two fixture lessons — accentVar, seeded narration — both
recurred here; producer-level tests are the antidote). Full `pnpm test` gate before commit.

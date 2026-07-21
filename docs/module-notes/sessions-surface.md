# Sessions surface (nav + unified session thread + monitor) — module notes

**Status:** design 2026-07-21, Chad-approved shape ("what you describe — yes exactly we
need that"). Build order: the owed cf15137 adversarial review first, then Slices ①→④.
Successor arc to the session-library slices (memory `session-library-product-decisions`);
subsumes the recorded "monitor arc" front half.

## Chad's advice (the why)

- **The nav becomes Home | Chat | Sessions** (replacing the Home | Chat toggle), per
  scope — the same trio in a workspace and in global.
  - **Home** — the dashboard, as today.
  - **Chat** — always THE continuing conversation (the workspace/global primary; swaps
    invisible; "chat is always continuous").
  - **Sessions** — the library: every session in scope — spawned children AND the
    continuity fork segments (A ──%──▶ B chain parts). Each opens as a FULL chat-style
    view, live, and **directly chattable when needed** — it just isn't THE continuous
    thread.
- **One global component** that "registers for realtime vs old activity" so the same
  surface implements everywhere — global chat, workspace chat, sessions view, watch
  overlays. "They all are similar."
- **The drill-down hierarchy is `Session → Session | Agent`** — a session's activity
  contains child sessions (delegations/spawns) and child agents (SDK subagents), both
  openable nodes in the same viewer, recursively.
- Realtime monitor parity in BOTH workspace and global (today the workspace side has
  Watch chips off and direct-turn agents have no focused view).

## Shape

### 1. `SessionThread` — the one component

Transcript (persisted "old activity") + live overlay (realtime) + **optional composer**:

- **Chat view** = SessionThread pinned to the scope's primary, composer ON.
- **Sessions → session view** = SessionThread for any session, composer ON when the
  session is chattable (see locked decisions).
- **Watch overlays / agent drill-down** = SessionThread (or its entries body) composer
  OFF — replaces the SessionViewerPanel/SessionWatchPanel near-duplicates.

### 2. `useActivityMonitor(source)` — the one source seam

`ActivitySource = { kind: 'session' | 'trace' | 'agent', id }`. The composable loads the
settled history for the source (session transcript slice · `resolveDelegationTrace` ·
persisted `subagentNarrative`/`subagentToolCalls` via `deriveSettledAgentActivity`),
attaches the matching live stream (`session:<id>` SSE · `trace:<partialSessionId>` SSE ·
the parent turn's live map), and merges settled ∪ overlay into ONE state
(`entries`, `agentActivity`, `status`, `pendingApproval`, `isStreaming`). The existing
folds already share the `ChatTurnEvent` vocabulary (`applyTraceStreamEvent` serves both
trace + session watch) — this is convergence, not new plumbing. Fixes two recorded gaps
for free: the empty Watch-on-open (session watch loads no history today) and the
mid-run-attach missing pre-attach activity (settled fetch + overlay merge).

### 3. Drill-down store — the node stack

The session-viewer store's two-level `open/focusAgent/clearAgentFocus` generalizes to a
stack of nodes (`sessionRef | agentRef`); Back pops. An agent node needs NO trace
channel — its data is the live `agentActivity` map or the persisted subagent fields —
which is what finally makes a DIRECT (non-delegated) turn's agent watchable.

### 4. The new server surface: interactive turns into a session

`POST /sessions/:sessionId/turn` (shape of the chat-turn stream): resume the session's
CURRENT segment (the chain head), consume through the shared pipeline, tee onto the
session channel (Watch-everywhere already publishes), announce on the activity feed
(origin 'web'). Continuity applies unchanged (spawned sessions already pressure-swap).

## Locked decisions (Chad, 2026-07-21)

0. **Delegated workspace-root turns carry the session-routing trio** (the ④b
   "backgrounds structurally excluded" pin RE-DECIDED after the deferred-tool
   lesson): a delegated turn is the user's own request via the global root, so
   it composes `vynelWorkspaceInteractiveDescriptor` — the global → workspace →
   session chain works and the primary's toolset never flips per turn origin.
   Schedule fires and spawned-session targets stay on the plain set (autonomous
   turns don't route; leaves don't recurse). Built same-day
   (`buildDelegatedTurnMcpComposer`, target-aware).
0b. **The View → Conversations sidebar is superseded by Slice ③'s Sessions
   view** (Chad, on seeing "No past conversations"): the side listing becomes
   the SESSION list — every in-scope session with open-as-chat-view options —
   not a "finished topics" archive concept.

1. **User turns into a spawned session attach the BACKGROUND MCP set** (vynel +
   notebook — the same set its delegated turns attach after the mcp-attachment fix).
   Perfectly consistent toolset per session → zero deferred-tool deltas. RECORDED
   upgrade path: an interactive variant (ask/ssh) later if it's missed — accepting the
   same small per-origin deltas the workspace primary already lives with.
2. **Superseded chain segments are VIEW-ONLY.** "Chat into this session" always lands on
   the chain HEAD. Read the whole chain; write only at the tip. (Typing into a dead
   segment would fork history away from the chain — deliberately not offered.)
3. **A user turn QUEUES behind a running delegated task** on the same session (the
   delegation pool's single-writer-per-target FIFO extends to user turns); the composer
   shows "working on a task — queued" rather than rejecting.

## Slices (each lands green alone)

1. **① Source seam** — `useActivityMonitor` (settled + live merge, one fold home);
   recast `useSessionWatch` + `useDelegationTraceLive` over it. No visual change.
   Closes the empty-Watch and mid-attach gaps.
2. **② SessionThread + merged panel** — the one component with node-stack drill-down;
   SessionViewerPanel + SessionWatchPanel collapse into it (the delegation job
   status/Stop strip renders only for a trace-kind node). Presentational pieces in
   `@vynel/ui`; composable + store in `local-web` (house split).
3. **③ Nav + Sessions view** — Home | Chat | Sessions; the Sessions view lists all
   in-scope sessions (the Slice-③ overview op, per-scope) and opens SessionThread;
   NEW session-turn route + queue coordination (locked decisions 1–3).
4. **④ Coverage** — workspace threads get Watch chips ON; direct-turn agents get the
   focused view; linked-session chips open the monitor; **in-flight SESSION-target
   jobs surface Watch chips too** (Chad's smoke gap 2026-07-21: letterman routed into
   a spawned session and neither the global banner nor the workspace view offered a
   Watch chip for that run — today's chips cover only the root's own workspace
   delegations).
- **(Later — the deep monitor arc, unchanged scope):** the cross-session tree over
  `agent.run-started/completed` outbox events (today consumerless) + unparking
  `delegate-to-leaf-session`. Slices ①–④ need none of it.

## Parked follow-ons (Chad, 2026-07-21 — "complete whatever is on our plate first")

- **Inter-session communication MCP tool**: sessions talk to each other in the flow —
  they hold the context to decide where to send which report, how to communicate with
  each other appropriately, and can take actions when they need to. A future arc on top
  of the session library + the monitor tree; NOT part of Slices ①–④.

## Ground (recon 2026-07-21, full inventory in the session journal)

- Panels: `SessionViewerPanel` (trace + focused agent) · `SessionWatchPanel` (session
  channel, no history) · `AgentActivityPane` · `ToolCallList` ticker + Watch chips ·
  `LiveTurn`/ActiveTurnView (segmented primary-turn fold).
- Live: `use-delegation-trace-live` (settled GET + `trace:<pid>` overlay) ·
  `use-session-watch` (`session:<id>`, same fold, one-attach-one-turn) ·
  `active-turn-view` (the turn's own SSE). Server: routes/root `GET
  /trace/:pid/stream` · routes/sessions `GET /:id/stream` · the activity feed SSE.
- Settled: `resolveDelegationTrace` · migration-0010 subagent fields +
  `deriveSettledAgentActivity` · `root.getSession` + `attachDelegationTaskLabels`.
- Known asymmetries this arc closes: workspace `show-watch-chips="false"` ·
  direct-turn agents unfocusable · mid-run attach overlay-only · Watch opens empty.

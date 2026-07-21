# Sessions panel + context visibility — module notes

**Status:** DRAFT for Chad's review 2026-07-21 · Slice ③ of the session-library arc
(memory `session-library-product-decisions`) · the READ layer the session tools (Slice ④)
land into. Two additive columns on `chat_sessions` (one migration) — flagged per build
discipline; everything else is queries + UI.

## Chad's advice (the why)

- **Continuity is THE feature.** "We're helping users use Claude without the context
  issues we're facing." The pressure-swap already runs invisibly at 0.85; this slice makes
  it VISIBLE and trustworthy: when session A forks to B at ~80-85%, the user sees the
  chain, properly rendered — not a mystery reset.
- **One list, everything on it.** ALL sessions — root, workspace, spawned (Slice ④), and
  continuity segments — sorted by **last time used**. The user sees what's happening
  where.
- **Context usage is first-class.** The list shows each session's context occupancy —
  the same number the root will use to plan ("A is at 80% → spawn B"), shown to the user
  the same way.
- **Watch everywhere.** Any running session is watchable the way root→workspace
  delegations are today.
- **No archive work now** — users need their task done and visible, not lifecycle
  management.

## Current state (what exists to build on)

- **Occupancy is measured and thrown away.** `handle-usage-reported` already persists the
  REAL per-message occupancy (`inputTokens` = uncached + cache-read + cache-creation) on
  each assistant message, and `chat_sessions.model` is recorded as "the UI context-window
  denominator". `detect-context-pressure` computes the turn-end measurement for the swap
  decision — then drops it. Nothing session-level says "currently at 83%".
- **The chain is only half-recorded.** `primary_sessions.supersededFromSdkSessionId` keeps
  ONE hop (the last swap); `recordSwapSegmentSession` records each fresh segment as a
  browsable `chat_sessions` row — but no row points at its predecessor, so A→B→C is only
  reconstructable by timestamp heuristics.
- **Lists exist but are partial.** `listRecentChatSessionsForUser` excludes archived,
  deleted, AND hidden (the global brain is `visibility: 'hidden'` by design); the
  SessionsPanel dock lists per-workspace history. No unified all-scopes view.
- **Live status exists.** The activity feed (Slice ② made delegations announce too) knows
  every running turn's scope/workspace/session/origin — the panel's "working" dots are a
  read over state the UI already receives.
- **Watch is delegation-only.** The trace broadcaster keys on `partialSessionId`; the SSE
  observe route + fold + panel all exist — but only delegation runs publish.

## Shape

### 1. Data: two additive columns on `chat_sessions` (migration `0011_session_visibility`)

| column | notes |
|---|---|
| `lastContextTokens` (int, nullable) | the session's CURRENT context occupancy — written in `handle-usage-reported` beside the per-message write it already does (same event, one more SET; no new write path). Null until the first usage report. |
| `continuedFromSessionId` (text, nullable, LOOSE ref) | the chain link — stamped by `recordSwapSegmentSession` (it knows the predecessor's sdk session id at swap time). Null = chain head. |

- **The fork percentage is DERIVED, not stored**: the predecessor's `lastContextTokens`
  at swap time is exactly "forked at 83%" — one JOIN, no extra column, and it stays
  correct if the display formula changes.
- **`contextWindowForModel`** gets ONE home (`@vynel/contracts`, beside the model
  catalog): model id → window tokens. The occupancy fraction = `lastContextTokens /
  window`. (Both the panel and Slice ④'s `list_sessions` tool read this same function —
  the user and the root must see the SAME number.)

### 2. API: `GET /sessions/overview` (new, `x-sdk-name: sessions.overview`)

One query layer, one response shape, consumed by the panel now and re-exposed as the
`list_sessions` MCP tool in Slice ④:

- Every non-deleted session for the user across scopes — INCLUDING hidden ones surfaced
  as their scope identity (see fork B) — each entry: `sessionId`, `scope`
  (global | workspace | agent, the real chat_sessions union; spawned joins in
  Slice ④), `workspaceId`/`workspaceName`,
  `title`, `lastMessageAt`, `contextTokens`, `contextWindow`, `contextFraction`,
  `chainHeadSessionId` + `continuedFromSessionId` (the chain wiring), `isCurrent`
  (the segment the primary points at now).
- Sorted `lastMessageAt` DESC. Bounded (the house list cap) — chains count as their
  NEWEST segment for sorting.
- Live "working" status is NOT in this response — the UI marries the list with the
  activity feed it already subscribes to (one source of live truth; no polling column).

### 3. UI: the Sessions view

- **A unified Sessions surface listing every entry**: identity (scope icon + workspace
  name + title), relative last-used, a **context meter** (the occupancy fraction; amber
  ≥70%, the 85% swap line marked), a live "working" dot from the activity feed, Watch.
- **Continuity chains render as ONE conversation** (the user's mental model) with the
  chain expandable in place: `A ──83%──▶ B ──81%──▶ C (current)` — each hop labeled with
  the occupancy it forked at (the predecessor's persisted number). Copy leans on the
  product story: "continued automatically so you never hit the limit".
- Clicking a segment opens that segment's transcript (read-only for superseded segments —
  they're history; the CURRENT segment is the live conversation).
- Placement: its own left-nav section (`Sessions`), the sibling of Tasks — the existing
  right-dock history panel stays as-is (see fork A).

### 4. Watch everywhere (the generalized observer)

Today only delegation runs publish live events. Generalize with the machinery that
already exists:

- Every turn runner (workspace stream, global stream, channel background, schedule fire,
  delegation) publishes its `ChatTurnEvent`s to the SHARED `TurnEventBroadcaster` on a
  `session:<sessionId>` channel — publishing to a channel with no subscribers is already
  a no-op, so the cost when nobody watches is nil.
- One new SSE route `GET /sessions/:sessionId/stream` (ownership-gated like the trace
  route) + the panel's Watch opens the existing focused viewer over it (`fold-trace-stream`
  reused unchanged — it folds `ChatTurnEvent`s, which is exactly what flows).
- The delegation trace channel stays (its key is the JOB, needed by the stop path);
  a delegated turn simply publishes to BOTH keys.

### 5. Chat composer: the context ring + thinking effort (Chad, 2026-07-21 follow-up)

Claude-desktop parity on the composer row, both scopes (global + workspace chat):

- **Context ring.** A small circular meter beside the composer showing the CURRENT
  session's occupancy (`lastContextTokens / contextWindowForModel(model)`), with the
  amber-≥70% treatment and a tooltip breaking down the number ("~166k of 200k · continues
  automatically near 85%"). Two data feeds, both existing: settled = the session detail
  (the new column); live = the `usage-reported` turn events already streaming to the fold
  (the cache split included) — the ring ticks up DURING a reply, like Claude desktop.
  When a swap fires, the ring visibly resets — the continuity story told right in the
  composer.
- **Thinking effort picker.** A composer control beside the model picker (the exact
  mode/model-picker precedent: ui-store persisted, fail-closed against a catalog):
  `Auto · High · Medium · Low`. Threads as a new optional `thinkingEffort` on
  `StartChatSessionInput` → `buildClaudeSdkOptions` maps it to **the SDK's first-class
  `options.effort`** (AS-BUILT: the SDK grew a native EffortLevel option — no
  provider-owned budget table needed; the SDK silently downgrades unsupported levels
  per model). `Auto` = today's behavior, omitted — byte-for-byte unchanged for
  existing turns. Background turns (channel/schedule/delegation) stay on Auto v1 — the
  picker is an interactive-composer control.

## Forks for Chad

- **A. Panel placement.** Recommend: a dedicated left-nav `Sessions` section (the arc's
  centerpiece deserves a surface), keeping the right-dock history panel untouched. The
  alternative — growing the dock — keeps one fewer surface but buries the feature.
- **B. The global brain on the list.** It's deliberately hidden today. Recommend: show it
  as the root entry named "Assistant" (its continuity chain included — it swaps too, and
  it's the best demo of the feature). Alternative: keep it hidden and list only
  workspace/voice/spawned sessions.
- **C. Watch-everywhere scope.** Recommend: in this slice (step 4 — the machinery is
  reuse, and "watchable like delegations" was the locked requirement). Alternative: defer
  to the monitor arc and ship the panel with Watch on delegation-traced sessions only.
- **D. Thinking-effort levels.** Recommend the four-level picker (Auto/High/Medium/Low,
  provider-owned budgets) riding this slice's UI step — it shares the composer row work
  with the ring. Alternative: two-state (Auto/Extended) if fewer choices reads better
  for non-technical users, or split it into its own mini-slice after the panel.

## Tests (ship with the slice)

- Occupancy write: usage-reported updates `lastContextTokens` (multi-message turn keeps
  the LATEST); no report → stays null.
- Composer: the ring reflects settled occupancy, ticks on live usage events, resets after
  a swap; the effort picker persists + threads `thinkingEffort` → the provider's budget
  map (Auto omits the option entirely — pinned unchanged).
- Chain stamp: a swap records the segment with `continuedFromSessionId` = the superseded
  segment; the head stays null; `isCurrent` follows the primary's repoint.
- Overview query: cross-scope entries, chain grouping + newest-segment sort, hidden-scope
  surfacing per fork B, the bounded cap, tenancy (never another user's rows).
- `contextWindowForModel`: known models + the unknown-model fallback.
- Watch route: ownership 404, live events flow for a non-delegation turn, no-subscriber
  publish is a no-op (the existing broadcaster tests may already pin this).
- UI: meter thresholds, chain expansion rendering, working-dot from the feed, Watch
  opening the focused viewer.

## Deferred (recorded, not built)

- Spawned-session rows and the `list_sessions`/`create_session` tools — Slice ④ (the
  overview endpoint is BUILT FOR reuse there).
- Archive/idle-sweep — explicitly deprioritized by Chad.
- Chain COMPACTION lineage (a mid-session /compact is invisible to this model — segments
  track SWAPS only; the compaction-summary capture already exists separately).
- The `session.swapped` outbox event stays consumerless for now — the monitor arc's feed.

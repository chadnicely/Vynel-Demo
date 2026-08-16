# Session continuity everywhere — module notes + arc plan

*Opened 2026-08-17 from Kafi's report: the GLOBAL brain hit its context limit and continued on a
brand-new session with no carried context — amnesia. Research confirmed the mechanism is built and
scope-agnostic but its trigger is wired into exactly ONE path. This doc is the advice + the plan
for making continuity a uniform property of every session.*

---

## 1. Kafi's advice (the requirements — do not violate)

1. **Never lose chat.** The UI shows the FULL chat — the whole segment chain — no matter which
   SDK session is current. Chain view, not current-segment view. (Already structurally true —
   see §3.1 — but the arc pins it with per-scope regression tests.)
2. **All sessions work the SAME way.** Continuity lives in the session package as one shared
   behavior. Not "workspace has it, global doesn't". It was designed to be reused in several
   places — wire it that way.
3. **The A→B handoff is richer than a summary** (Kafi's sketch, 2026-08-17):
   - collect the last messages of A (verbatim tail),
   - the new session knows HOW to gather more — notebook instructions + the existing MCPs
     (memory, chats/sessions, journal, knowledge),
   - the swap shows a beautiful progress state ("Workspace is patching context…"),
   - every session ref is recorded, so on need the new session READS the old session and
     continues. There is no way to lose context when these bind together.
   - memories carry context tags at session level (workspace primary | child, with identity
     tag) — see §6 fork.
4. **Per-identity continuity, NO cross context** (Kafi, 2026-08-17): the primary session gets
   its continuity; a child session keeps HIS. A carry is composed ONLY from that identity's own
   chain — a mailing-feature session's carry is mailing context, nothing else. Cross-session /
   cross-feature context is never baked into a carry; on need the session PULLS it via the
   memory / knowledge / journal / sessions tools.
5. **One home for carry composition — the contextBuilder.** Continuity is simply: a session
   starts → before it hits the context limit we prepare the next one. That preparation is ONE
   function (`buildContinuityContext`, §4.3) used everywhere a seed is composed.
6. **A `whoami` tool on every session** (§4.4): the session reads its own identity (scope,
   workspace, agent slug, primary id, chain refs) — to tag what it saves to memory with its
   identity, and so its identity can drive building its own context.

## 2. The bug (root cause, verified 2026-08-17)

The seed-fresh swap (distill → seeded fresh session → repoint) fires from exactly one call site:
the **interactive workspace chat route** (`apps/local-api/src/streams/chat-turn.ts:347` →
`applyPrimaryTurnContinuity`). Every other runner only LINKS the primary and never evaluates
pressure:

| Runner | Covers | Today |
|---|---|---|
| `apps/local-api/src/streams/chat-turn.ts` | workspace interactive chat | ✅ links + bridges @0.85 |
| `packages/session/src/runtime/run-global-root-turn-core.ts` | global web SSE + channel turns + report-delivery turns + voice turns | link only (`:284`) |
| `packages/session/src/delegation/delegate-to-workspace-root.ts` | background delegated workspace runs | link only (`:230`) |
| `packages/session/src/delegation/delegate-to-spawned-session.ts` | spawned sessions | link only (`:234`) |
| `packages/session/src/delegation/delegate-to-agent-session.ts` (+ `run-agent-run-job.ts`) | agent colleagues | link only (`:210`) |

Three concrete misses on the global path (`run-global-root-turn-core.ts`):

- **No occupancy tracking.** The core's event loop never reads `usage-reported` (the workspace
  route accumulates `inputTokens + cacheRead + cacheCreation` at `chat-turn.ts:280-283`). Global
  cannot even know it is under pressure.
- **No bridge call.** Neither the core nor its two callers (`streams/global-root-turn.ts`,
  `sessions/run-global-root-turn.ts`) invoke `applyPrimaryTurnContinuity` /
  `bridgePrimarySessionAfterTurn`.
- **No `onCompaction`.** `startChatTurn` passes the Layer-1 PostCompact capture
  (`start-chat-turn.ts:165`); the global core's `provider.startChatSession` call does not.

**Failure sequence observed:** global session grows unchecked → blows past the 0.85 threshold
unmeasured → SDK hits its own ceiling → provider-initiated mid-turn swap (a new SDK id on a
resumed turn) → `handleSessionStarted`'s B4 branch records the segment chain-linked, the core
links the primary to it → next turn resumes a near-empty session. Rows + chain display survive
(B4, `b330aab`); the MODEL's context is gone because the distill step is exactly what never ran.

**Why it wasn't wired when workspace was:** the composition is workspace-typed —
`bridgePrimarySessionAfterTurn` (`BridgePrimarySessionAfterTurnInput.workspaceId: string`) and
`recordSwapSegmentSession` (`RecordSwapSegmentSessionInput.workspaceId: string`) demand a
non-null workspaceId; the global root has none (its cwd is the hidden user-data dir). And the
continuity call must run INSIDE `runUnderRootTurnLock`, which lives inside the core — callers
structurally cannot do what `chat-turn.ts` does from outside.

**Urgency note:** the 0.85 threshold exists so the distill runs while the session still fits the
model's window. At 100% the summarize (which resumes the huge session) can itself degenerate —
the 869k-token / 18-char-summary tester-DB incident (2026-08-14) is why
`MIN_CARRY_SUMMARY_LENGTH` exists. The swap must fire BEFORE the ceiling; global today has no
before.

## 3. What already exists (verified — build on it, don't rebuild)

### 3.1 Chain display (requirement 1) — DONE, pin it
`resolvePrimaryTranscript` / `resolveSessionChainTranscript`
(`packages/session/src/runtime/resolve-primary-transcript.ts`) walk the chain from the ROWS
(`continuedFromSessionId`, cycle-safe, owner-gated) and serve all three surfaces: the global
thread (`routes/root/index.ts:125`), each workspace's main chat (`routes/chat/index.ts:219`),
and chains opened from the Sessions panel (`routes/root/index.ts:287`). A swap never deletes
rows; even the SDK's uninvited mid-turn swap chain-links (`handle-session-started.ts:90-141`).
The 2026-08-14 workspace single-segment bug is FIXED (one resolver for both scopes — the
resolver's header records the incident). ⚠ Stale memory `workspace-swap-empty-transcript-bug`
says otherwise — the code wins.

### 3.2 The recall tools (requirement 3's "on need they can read") — EXIST
`list_sessions`, `search_chat_messages`, `get_chat_session` are x-mcp tools
(`apps/local-api/src/routes/sessions/index.ts:66,102,151` — rootSurface +
workspaceInteractiveSurface), alongside the memory / journal / knowledge / notebook tools.
Every segment records its predecessor (`chat_sessions.continuedFromSessionId`); the primary
records the one-hop supersession; `session.swapped` goes to the outbox. What's missing is only
that the carry never TELLS the new session any of this.

### 3.3 The scope-agnostic mechanism — EXISTS
`getOrCreateContinuingSession` (workspace | global | voice | agent),
`detectContextPressure`, `bridgePrimarySession` (identity in, no scope logic),
`runSeededSwapSession` (priming turn, tool-free, 120s bound, carry rides the first USER message
so resume replays it). Only the composition layer + trigger wiring are workspace-bound.

## 4. Design

### 4.1 The handoff (A → B)

```
Session A (≥0.85 of window, measured at turn end, in-lock)
  │   UI: "Patching context…" (activity feed + composer status)
  ├─ distill summary (existing — runs on the turn's own model)
  ├─ + verbatim last-K message tail (from chat_messages — no model call)
  ├─ + identity line ("you are the global primary" / "workspace primary of X" / "colleague Y")
  ├─ + refs: predecessor SDK session id + "chain is recorded"
  └─ + recovery instructions: get_chat_session(<id>) / search_chat_messages /
       memory / journal / knowledge tools; the notebook continuity book says how
        ↓ seed-fresh swap (existing) → Session B, repointed, chain-linked
Session B's REAL turns gather more on demand — the MCPs are already attached there.
```

**Settled trade-off (Kafi may overrule):** the memory/journal/knowledge GATHERING happens
on-demand in B's real turns, not during the swap. The real turns already carry every MCP (zero
new plumbing); the swap stays seconds-fast and cannot fail on a tool error mid-handoff; and
on-demand reads fetch what the actual next question needs instead of guessing. The swap seeds
the MAP (summary + tail + identity + refs + instructions). The progress UI ships either way.
If active in-swap gathering is wanted later: same seed + a tool-enabled priming turn — plan it
as its own move (slower, more failure surface inside the swap).

### 4.2 One op, every runner
Generalize `applyPrimaryTurnContinuity` into THE scope-agnostic post-turn continuity step and
call it from all five runners (inside each runner's lock). The op = link (existing) + measure +
bridge-if-pressured. No per-path variants — parameterized by the primary id, cwd, occupancy,
model, threshold.

### 4.3 `buildContinuityContext` — the contextBuilder (one home)
The carry composition extracted into one function, `packages/session/src/runtime/
build-continuity-context.ts`. Input: the identity (the primary row — scope, workspace,
scopeRef), its own chain (predecessor SDK session id), the distilled summary, and the
tail-read deps. Output: the carry string (§4.1's block). The bridge consumes it
(`bridgePrimarySessionAfterTurn` → `startSeededSession`); `createSpawnedSession`'s
purpose-as-seed priming can reuse it later.

**Invariant enforced HERE (requirement 4):** the function reads ONLY the identity's own chain —
its own `chat_messages`, its own summary, its own refs. It never queries another session,
another workspace, or shared stores. Cross-context is the RUNNING session's pull via tools,
never the builder's push.

### 4.4 `whoami` — the session's identity read
A per-session tool: returns scope (`global | workspace | spawned | agent`), workspace id/name,
agent slug (scopeRef), primary session id, current segment id, predecessor ref. The composition
already knows the identity at compose time (`composeSessionMcpServers` receives `sessionId`;
the ambient turn-session header is the `set_todos` precedent) — wire per the mcp-development
house paths, exposed on every surface (root + workspace-interactive + delegated), read-only,
never cards.

Why it earns its place: (a) the session TAGS what it writes to memory with its identity — the
session-level memory tagging Kafi sketched, working NOW by convention, no schema change;
(b) the identity is self-readable, so a session can rebuild/deepen its own context deliberately
("what am I, what chain am I on, what should I recall") instead of only being told at seed time.

## 5. The slices

### Slice 1 — one op, wired everywhere (fixes the reported bug)
1. **Widen the composition to workspace-less scopes:**
   - `BridgePrimarySessionAfterTurnInput.workspaceId: string | null`;
     `ApplyPrimaryTurnContinuityInput.workspaceId: string | null`.
   - `RecordSwapSegmentSessionInput.workspaceId: string | null` + stamp the segment's `scope`
     from the primary/predecessor (the same rule `handleSessionStarted`'s swap branch uses —
     a global swap segment lands scope `'global'`/hidden, a spawned one `'spawned'`, never a
     stray default).
2. **Global core** (`run-global-root-turn-core.ts`): accumulate `occupancyTokens` from
   `usage-reported` + capture the effective session id + model in the event loop; after the
   stream drains, STILL INSIDE `runUnderRootTurnLock`, call the op (workspaceId null, cwd = the
   hidden user-data dir). Covers web + channels + report turns + voice in one move. File is at
   the ~300-line ceiling — extract the continuity tail into a small runtime helper.
3. **`onCompaction` parity:** pass `captureCompactionSummary` on the global path (and any other
   runner missing it) — Layer-1 capture everywhere Layer 2 runs.
4. **Delegation runners sweep:** the same measure + op call in `delegate-to-workspace-root`,
   `delegate-to-spawned-session`, `delegate-to-agent-session` (their locks already serialize the
   target). The `apply-primary-turn-continuity` hidden-visibility first-turn rule stays
   workspace/global-only (spawned/agent segments already record their own presentation).
5. **Tests:** a global-scope case in the bridge-after-turn suite (workspaceId null → segment
   scope 'global'); a core test pinning occupancy tracking + the in-lock trigger; per-runner
   trigger tests (mock provider dep, the existing pattern); per-scope chain-display regression
   tests (swap → `resolvePrimaryTranscript` / `resolveSessionChainTranscript` spans segments).

### Slice 2 — `buildContinuityContext` (the contextBuilder; Kafi's A→B protocol)
1. **The function** (§4.3): one home composing the carry — distilled summary + verbatim last-K
   message tail (role-labelled, K≈10, char-capped, from the identity's OWN `chat_messages`) +
   identity line + predecessor refs + the recovery-instructions paragraph. Own-chain-only
   invariant enforced inside. `bridgePrimarySessionAfterTurn` consumes it; carried through
   `runSeededSwapSession` unchanged (opaque carry string).
2. **Notebook book:** ship a curated "session-continuity" book (how to re-gather context:
   which tool for what, in what order) — content move in `@vynel/instructions`, no code.
3. **Tests:** contextBuilder unit tests (tail cap, identity per scope, refs present,
   own-chain-only — a foreign session's rows never leak in); the live swap smoke extended to
   assert next-turn recall of a tail fact.

### Slice 3 — `whoami` (the identity tool)
1. The per-session identity read (§4.4), wired per `mcp-development` (route-derived or
   descriptor-owned — whichever the ambient-session seam makes cleaner), exposed on every
   surface, read-only tier, parity guards green.
2. The memory-tagging convention documented in the continuity notebook book: "when saving a
   memory, stamp your whoami identity" — session-level memory tags working by convention.
3. **Tests:** identity shape per scope (global / workspace / spawned / agent); tool census +
   parity.

### Slice 4 — visible progress
1. `session.swapping` outbox event at bridge start (sibling of the existing `session.swapped`);
   activity-feed step ("Patching context…") around the bridge; a stream frame/composer status so
   an interactive turn shows the state instead of a dead composer; a turn arriving mid-swap
   (parked on the lock) shows the same state (the `turn-queued` sentinel precedent).
2. **Tests:** event co-commit + feed-step emission; frame shape pinned in the stream tests.

Slice order is dependency order: 1 alone cures the amnesia; 2 rides 1's widened composition;
3 is independent (can land any time after 1 — its tagging convention feeds 2's recall story);
4 is UI polish on 1's trigger points.

## 6. Forks / deferred (decide deliberately, never slip in)

- **Memory session-level identity tags, FIRST-CLASS** (Kafi's sketch, left box): the
  by-convention tagging ships in Slice 3 (whoami identity stamped into saved memories). A
  first-class tag COLUMN on memory rows (filterable, queryable) is a `@vynel/memory` SCHEMA
  change → its own planned move (drizzle generate, never hand-written) — do it when the
  convention proves the query patterns.
- **In-swap active gathering** (tool-enabled priming turn): deferred per §4.1 — revisit only if
  on-demand recall proves insufficient in practice.
- **Voice-scope primary runner:** voice turns ride the global primary today; the dormant
  `'voice'` scope gets continuity for free when its runner lands (the op is scope-generic) —
  nothing to build now.
- **Persisted occupancy:** the swap measures occupancy then discards it (session-library note);
  persisting per-session occupancy is the sessions-panel arc's item, not this one.

## 7. Verification

- Gate: targeted typecheck + vitest per move (full `pnpm test` is Chad's call — CPU rule).
- Live smoke (the Slice-1 exit): lowered threshold on the GLOBAL brain → one long turn → next
  turn recalls a pre-swap fact + the transcript shows the full chain + the sessions panel folds
  the chain — the same smoke shape the workspace swap used (build brief Slice 1 §6).
- Reviewer (`code-reviewer`) on each slice's diff before commit.

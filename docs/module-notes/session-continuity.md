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
8. **Checkpoint + auto-continue** (Kafi, 2026-08-17, refined after the first live swap): the
   boundary swap can't save a task that outgrows its window INSIDE a turn. Tell Claude — quietly —
   that it crossed the threshold and still has ~15% headroom: finish the slice it is on, then
   checkpoint; the swap carries context the way it already does (the distill — "our current one
   is working fine", NO self-written hand-off), and the fresh session continues to the next
   slice automatically, WITHOUT asking the user, while the UI shows patching → continuing.
   Self-orientation: the model can read its own context state and decide the cut. See §4.6 +
   Slice 5.
7. **Per-KIND duty notebooks — functionality now, content later** (Kafi, 2026-08-17): every
   session KIND gets a duty notebook (global root, workspace manager, spawned, agent…) that
   teaches it its duty; the session reads HIS kind's book and behaves with it. Kafi's drafts
   live under `.notes/` (`Global Root.txt`, `Workspace Manager.txt`, `Workspace.txt`, plus
   feature notes) — still being completed, attached later. We build the BINDING now (§4.5) so
   the moment a book lands, sessions behave with it — zero code change at content time.

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
| `apps/local-api/src/streams/session-turn.ts` | the user DM-ing a spawned session / colleague directly | link only (`:319`) — found by the Slice-1 reviewer |

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

### 4.6 Checkpoint + auto-continue — the model lands the cut, the swap carries as today
Three cooperating pieces, layered on §4.1–4.3 (never replacing the boundary swap):

- **The nudge (at the threshold, headroom-aware):** crossing 0.85 is not a cliff — ~15% remains
  (150k on a 1M model; only ~30k on Haiku, so the nudge quotes TOKENS, not just %). When a turn's
  LIVE occupancy (the consumer already sees `usage-reported` per assistant message) crosses the
  threshold, the model is told: "you've crossed 85% of your context; ~150k remains — finish the
  slice you're on, don't start another large one, then call `checkpoint` with what comes next;
  you'll continue on a fresh context automatically." Between turns it rides the NEXT provider
  input as a per-message marker (the voice/channel-marker precedent — recency wins). MID-TURN
  (a long agentic turn crosses the threshold with no next input) the only channel into the model
  is tool results — SPIKE FIRST: a provider-owned `PostToolUse` hook (we already own the
  PreToolUse backstop) injecting one line once per crossing; fall back to appending the line to
  our own MCP tool results if the SDK ignores hook context. `whoami` (§4.4) also reports
  occupancy / window / thresholds so the model can ask "where am I" and plan the cut itself.
- **The tool (`checkpoint`), slim:** `{ nextStep }` — one line, the explicit "I stopped here to
  swap; continue with this". NO hand-off prose (Kafi: the current carry works — skip the self
  context pass). The tool records the pending checkpoint on the identity and answers
  "acknowledged — end this turn with a one-line note to the user ('I'll continue after patching
  context')". Same tool on every surface (requirement 2). Why a tool at all: the runtime must
  tell "checkpointed mid-task" from "finished the task" — auto-continuing after every boundary
  swap would restart idle conversations.
- **The swap:** exactly today's — distill + the contextBuilder extras (tail, identity, refs,
  recovery instructions) + the checkpoint's `nextStep` line.
- **Auto-continue:** ONLY when a checkpoint is pending: the runtime starts a continuation turn on
  the fresh segment ("continue: <nextStep>") under the row's inherited mode/model/effort, WITHOUT
  asking the user; the UI shows "Patching context…" → "Continuing…" and the same thread keeps
  flowing. A boundary swap with no checkpoint (an idle conversation, or a task the model
  finished) never auto-runs anything — the user's next message continues it, as today. For
  delegated / spawned / colleague runs the continuation is a follow-up job on the same target
  through the delegation queue.

**Trade-offs settled (Kafi 2026-08-17):** carry = the external distill (+ builder), never
model-written · no forced mid-tool interruption (cutting a tool loop loses in-flight work; the
SDK's own compaction — Layer 1 captures its summary — is the last resort) · the ladder is
threshold-nudge 0.85 (headroom-aware) → boundary swap when the turn lands → SDK compaction
~0.9x if a turn ignores both.
**Settled 2026-08-18 (Kafi):** the continuation runs with the SAME model / thinking effort /
mode as the turn that checkpointed — by construction: the interactive streams resolve
`turnSettings` once per request and the continuation closure reuses it, a delegated follow-up
job copies the original job's columns, the global core reuses its input. Since a chip change in
the composer only persists on the next SEND, "the row's current settings" and "the checkpointing
turn's" are the same values today; honoring a mid-run chip change would need the chip to persist
immediately AND the loop to re-read the row before each continuation — not wanted; keep it
predictable: what you sent with is what the whole run (continuations included) uses.

### 4.5 Duty-book binding — kind → notebook, resolved not hardcoded
The seam that makes requirement 7 work before the content exists:

- **Convention:** one duty book per session kind, deterministic slug — `duty/global-root`,
  `duty/workspace-manager`, `duty/spawned`, `duty/agent` (an agent colleague may later get a
  per-slug override book; the kind book is the fallback). One tiny resolver
  (`resolveDutyBookSlug(kind)`) owns the mapping — no string literals scattered.
- **Self-discovery:** `whoami` returns `dutyBook: { slug, exists }` — the session learns from
  its own identity which book is HIS and whether it's there yet.
- **Standing pointer:** the per-kind session instructions (editable markdown,
  `@vynel/instructions/session-instructions`) and the carry's recovery block both say the same
  one line: "your duty book is `<slug>` — read it via the notebook tools when it exists."
  Reading stays ON-DEMAND via the existing notebook list/read tools — never prompt-injected
  (the locked notebook model).
- **Graceful absence:** a missing book is a normal state — `exists: false`, no error, no log
  noise, the session simply works without it. The day Kafi publishes the finished `.notes/`
  drafts as books, every session of that kind starts reading its duty — no release, no code.

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

### Slice 3 — `whoami` + duty-book binding
1. The per-session identity read (§4.4), wired per `mcp-development` (route-derived or
   descriptor-owned — whichever the ambient-session seam makes cleaner), exposed on every
   surface, read-only tier, parity guards green.
2. The duty-book binding (§4.5): `resolveDutyBookSlug(kind)` + `dutyBook: { slug, exists }` on
   whoami + the one-line standing pointer in each per-kind session instruction and in the
   carry's recovery block. Graceful absence pinned by test (missing book → exists:false, no
   error path).
3. The memory-tagging convention documented in the continuity notebook book: "when saving a
   memory, stamp your whoami identity" — session-level memory tags working by convention.
4. **Tests:** identity shape per scope (global / workspace / spawned / agent); duty-slug
   mapping; tool census + parity.

### Slice 4 — visible progress
1. `session.swapping` outbox event at bridge start (sibling of the existing `session.swapped`);
   activity-feed step ("Patching context…") around the bridge; a stream frame/composer status so
   an interactive turn shows the state instead of a dead composer; a turn arriving mid-swap
   (parked on the lock) shows the same state (the `turn-queued` sentinel precedent).
2. **Tests:** event co-commit + feed-step emission; frame shape pinned in the stream tests.

### Slice 5 — checkpoint + auto-continue (§4.6)
0. **Spike:** can a provider-owned `PostToolUse` hook inject one line of context mid-turn (the
   mid-turn nudge channel)? Yes → use it; no → append to our own MCP tool results.
1. **Nudge:** headroom-aware text (tokens + %) composed in ONE home (`composeContextNudge`,
   beside the voice/channel markers); between turns on the next provider input, mid-turn via
   the spiked channel; `whoami` grows occupancy / window / thresholds.
2. **Tool:** `checkpoint({ nextStep })` (descriptor-owned, every surface, never cards) → records
   the pending checkpoint on the identity; the boundary carry appends the `nextStep` line.
3. **Auto-continue:** continuation turn on the fresh segment ONLY when a checkpoint is pending —
   interactive streams run it in-place (the SSE stream stays open: "patching → continuing"),
   delegated targets enqueue a follow-up job.
4. **Tests:** nudge composition (tokens per model window) + when it fires; checkpoint row +
   carry line; auto-continue gating (boundary swap without a checkpoint never continues); per-
   runner continuation.

Slice order is dependency order: 1 alone cures the amnesia; 2 rides 1's widened composition;
3 is independent (can land any time after 1 — its tagging convention feeds 2's recall story);
4 is UI polish on 1's trigger points; 5 needs all three (2's builder composes the seed, 3's
whoami gives self-orientation, 4's states show patching → continuing).

## 5b. Slice 1 — SHIPPED 2026-08-17 (decisions taken while building)

Wired, tested (op per-scope + 3 runners + a new global-core test + swap-segment
scope/ground cases; 71 files / 448 targeted tests green, typecheck green on
session/chat/local-api). Decisions that go beyond the plan text:

- **Occupancy + model are read from the ROW, not re-measured per runner.** The
  shared consumer's `handle-usage-reported` already writes the effective
  segment's `chat_sessions.lastContextTokens` ("the LAST usage report of a turn
  IS the current occupancy") + `model` (what actually ran) for every runner.
  `applyPrimaryTurnContinuity` reads exactly those two — one measuring home; the
  workspace route's in-stream accumulator was removed. A segment with no usage
  yet (a fresh identity's first turn, a turn that failed before its first
  assistant message) measures 0 → never bridged.
- **The identity drives the op** — no caller-supplied ground. The op reads the
  primary row (owner-checked): `workspaceId` = the identity's own ground (null =
  workspace-less), scope decides the first-segment rule. A caller passing the
  wrong ground was a real bug class (the spawned runner filed a workspace-
  grounded session as the brain's, fixed the same day) — the op reads the truth.
- **hide-first-segment is manager-only** (`workspace` / `global` / `voice`): their
  first segment IS the continuing thread (created listed by the normal flow →
  hidden so the thread shows as one entry). A colleague's or spawned session's
  first segment is its LISTED identity row — never hidden. Pinned per scope.
- **Swap segments inherit `scope` from the predecessor row** — one rule shared
  with `handleSessionStarted`'s mid-turn swap branch (settings/status inherit
  the same way since 2026-08-17). No predecessor (legacy) → the builder default.
- **When the op runs:** after a CLEAN drain (an in-stream `session-errored` — the
  limit-error case — is a clean drain and DOES run it), inside the runner's
  lock, after `sink.onEnd`. NOT on a thrown core run: nothing reliable to
  measure, and it would delay the error frames by a whole provider startup
  timeout. The delegation runners run it before their outcome throws (an
  interrupted/errored routed turn still gets its boundary check — the
  interactive route's `finally` semantics).
- **Latency trade-off (accepted):** on the rare pressured turn a channel reply
  (Telegram) is delivered AFTER the swap (the drain sink returns after the
  core), and an SSE stream stays open past `turn-stream-ended` while it runs.
  Correctness first — the next turn MUST resume the fresh segment, serialized
  under the lock. Slice 4 makes the wait visible ("Patching context…").
- **Threshold override** (`VYNEL_CONTEXT_PRESSURE_THRESHOLD`) is forwarded on the
  SSE global path (the smoke knob), like the workspace route; the channel runner
  runs the production 0.85.
- **Layer-1 parity:** `buildCompactionCapture(db, { logger })` is the ONE home for
  the `onCompaction` hook — every runner binds it (the event's consumer is still
  a follow-up unit).
- **Core split** (file-size cap): the runner contract types moved to
  `session-types.ts`; provider-message composition (catch-up + voice/channel
  markers) extracted to `compose-global-root-provider-message.ts`; the core grew
  a `provider?` override dep (the test seam; registry singleton by default).
- **Test seam:** `FakeAiAgentProvider` grew `sessionIds` (per-call ids — the turn
  then the priming session), `usage` / `usageReports` (per-call usage so the
  consumer persists occupancy). The op's old tests took `occupancyTokens` /
  `model` / `workspaceId` inputs that no longer exist — recast to seed the row.

- **Reviewer pass (0 must-fix, 5 should-fix — all taken):** the swap's own log
  lines now reach every path (`BridgePrimarySessionAfterTurnDeps.logger` +
  `RunSeededSwapSessionInput.logger` widened to `StructuralLogger`, the core
  hands its logger through) · the distill got a wall-clock deadline
  (`DISTILL_TIMEOUT_MS` = 240s in `run-claude-distill-turn.ts` — a stalled
  CLI can no longer wedge the per-user root lock; aborted → null → the swap
  aborts cleanly) · the consumer resets its `sessionModel` state on a mid-turn
  segment change (the fresh segment used to end the turn with model NULL → the
  op measured it against the 200k floor and distilled on the CLI default) ·
  the SIXTH link-only runner (`streams/session-turn.ts`, direct DMs into a
  spawned session / colleague) now runs the op under its target lock ·
  `applyPrimaryTurnContinuityBestEffort` is the one home for the best-effort
  guard (six call sites, no copied try/catch).
- **Recorded divergence:** the global core skips continuity on a THROWN drain —
  including an SSE client disconnect (its sink writes raw `stream.writeSSE`) —
  while the workspace/DM streams run it in `finally`; the row keeps its
  occupancy either way, so the next turn measures it. Slice 4 revisits with the
  visible swap state.
- **Deferred-improve:** the three delegation runners were over the ~300-line cap
  before this move (339/340/301 at HEAD) and grew ~22 lines each — split on the
  next touch (the shared drain loop is the obvious extraction).

**Follow-up recorded (not built):** a single turn that jumps from under 0.85
straight into a limit error is not bridged by measurement (the row still says
<0.85). Slice 2's contextBuilder adds the DB-tail carry that needs no SDK
distill; pair it with a "limit-errored turn → force the bridge" rule then.

## 5c. Slice 2 — SHIPPED 2026-08-18 (the contextBuilder)

- **`buildContinuityContext`** (`packages/session/src/runtime/build-continuity-context.ts`) is
  the one home for the carry: IDENTITY (per scope — global / voice / workspace by name / spawned
  + colleague named from the chain's LISTED origin row) → HAND-OFF SUMMARY (the distill) → LAST
  MESSAGES (verbatim: newest 10 non-empty rows, 600 chars each, 5k total, `[role · sourceLabel]`)
  → the predecessor ref → fixed RECOVERY instructions (session/memory/knowledge/journal tools +
  the notebook book). Own-chain-only, owner-gated — a stranger's or an unrelated session's rows
  can never ride in (test-pinned). `bridgePrimarySessionAfterTurn` composes through it; the
  bridge still requires a usable summary (the fidelity floor) — the builder's nullable summary is
  the seam the forced-bridge follow-up will use for a tail-only carry.
- **Two lean chain readers** beside the transcript resolvers: `resolveSessionChainOrigin`
  (the identity row) and `listSessionChainTailMessages` (newest N across the chain, no tool
  calls). `resolveSpawnedSessionDisplayName` now reads the ORIGIN row — a boundary swap on a
  spawned session (routine since Slice 1) had made it read "Session".
- **Notebook book `session-continuity`** shipped on the verified shelf: read the carry
  properly → pull more only on need, in order (own history → memory → knowledge → journal) →
  never mix contexts → don't announce the swap.
- **Recovery instructions are capability-conditional** ("if session tools are available…"): a
  global-grounded spawned session runs toolless (bare) and `get_chat_session` /
  `search_chat_messages` exclude the global assistant's own thread today — so the paragraph
  promises nothing a surface lacks. Slice 3 (whoami) makes it precise per identity; letting the
  global root read its OWN chain by id is a Slice-3 item (identity-aware exclusion).
- **Priming prompt** reworded to frame the structured hand-off; same walls (no tools, absorb,
  "Ready to continue").
- **Reviewer pass: clean, 0 must-fix; 3 should-fixes taken** — one home for "the name is the
  LISTED origin row" (`resolveListedOriginTitle`, used by the carry and the delegation labels),
  the carry log carries ids + counts only (never the identity prose), `toThrow(NotFoundError)`;
  plus voice-identity + total-cap tests. Recorded nit: a spawned session's BIRTH still seeds its
  purpose through the swap priming prompt — route the birth through the builder next time the
  spawned rails are touched.

## 5d. Slice 3 — SHIPPED 2026-08-18 (`whoami` + the duty-book binding)

- **`whoami`** = a descriptor-owned tool (`vynel-session` server, `mcp__vynel-session__whoami`,
  `packages/session/src/mcp/`), on EVERY surface kind (catalog + composition sites; parity
  regenerated). Path B, not a route: a route would need the ambient turn-session header the
  delegated background runners never stamp — and spawned / colleague sessions are exactly the
  identities that most need to know who they are. The answer is computed at CALL time from the
  compose context: `sessionId` (the stable PRIMARY id), the ground, the LAZY chat id, and the
  swap threshold the apps edge passes (factory, the `vynel-ask` precedent — a 5% smoke never
  reads "85%").
- **`resolveWhoamiReport`** (runtime) answers: kind (primary scope, or `plain` for a
  conversation with no continuing identity), the identity prose (`describeContinuingIdentity`
  — the ONE home the carry's IDENTITY line shares), primary / current segment / previous
  segment ids, context state from the current segment's persisted row (used tokens, window,
  fraction, swap threshold, tokens until the threshold and until the window — the numbers
  Slice 5's checkpoint reasons about), `dutyBook: { slug, exists }`, `memoryTags`.
- **Duty-book binding** (`duty-book.ts`): kind → kebab shelf id — `duty-global-root` (voice
  reads it too), `duty-workspace-manager`, `duty-spawned-session`, `duty-agent-colleague`,
  `duty-workspace-session` (plain). `exists` reads the VERIFIED shelf (only it carries ids a
  binding can name; user notebook docs are UUID-keyed) through the new light subpath
  `@vynel/instructions/playbooks` — the barrel would put the SDK builder on session's
  module-load path. Publishing Kafi's `.notes/` drafts = dropping files with those ids into
  `packages/instructions/notebooks/`; `exists` flips true with zero code change.
- **The standing pointer** lives in three places, one line each: the carry's recovery block
  (present / not-published-yet, honestly), `global-root.md` (its slug), `workspace-agent.md`
  (via whoami — that prompt serves several kinds), plus `whoami`'s own `contributePrompt`
  line ("call whoami … use its memory tags").
- **Memory-tagging convention** (in the `session-continuity` book): stamp `whoami`'s
  `memoryTags` — `identity:<kind>`, `session:<8-char primary handle>`, the identity's name —
  on every `create_memory_entry` / `update_memory_entry`. Working by convention now; a
  first-class memory column stays the §6 fork.
- **Identity per site:** global (both runners) pass the global primary; the workspace stream
  resolves the workspace primary BEFORE composition when continue-mode is active (idempotent
  get-or-create); the DM stream passes the spawned/colleague primary (global-grounded spawned
  gets whoami standalone — its one server); the delegated composer derives it from the job's
  target primary or, for workspace-root, `findPrimaryConversation`; schedule fires start a
  fresh session and pass none → `plain`, honestly.
- **Reviewer pass: 0 must-fix, 5 should-fixes — 4 taken, 1 accepted:** `previousSegmentId` reads
  the ROW chain first (the primary's supersession marker is bridge-only and goes stale across a
  later mid-turn swap) · the swap-threshold knob now reaches EVERY runner's boundary op (tick
  deps → the three delegation runners; the channel runner; the DM stream — so whoami's report is
  true on all of them, and a 5% smoke swaps everywhere) · duty-book existence is injectable and
  the tests no longer pin the LIVE shelf (the day the `duty-*` books land, no test goes red) ·
  the DM stream's stale "no ground → nothing" rationale rewritten (its DELEGATED turns compose
  the root toolset since 2026-07-26 — a per-origin toolset difference recorded as a deferred
  product call: route that branch through `buildDelegatedTurnMcpComposer`) · ACCEPTED: the
  brain's very first delegated turn into a never-opened workspace reads `plain` for that one
  turn (the composer READS the primary; the runner get-or-creates right after).
- **Recorded follow-up (Slice 3 item from §5c):** `get_chat_session` / `search_chat_messages`
  still exclude the global assistant's own thread — with whoami the caller identity is known,
  so an identity-aware exclusion (the global root may read ITS OWN chain by id) is the next
  touch on those routes. Deferred-improves: hoist the `McpToolFn` twin into `@vynel/mcp-contract`
  (four copies now); the stream files stay over the ~300 cap (pre-existing).

## 5e. Slice 4 — SHIPPED 2026-08-18 (the visible swap)

- **Continuity now RIDES the turn stream** — `withBoundaryContinuity(turnStream, input, deps)`
  (`packages/session/src/runtime/with-boundary-continuity.ts`): the wrapper yields the turn's
  events, tracks the effective segment, and at the stream's clean end runs the two-phase op
  (`prepareTurnContinuity` = link + measure + detect · `runTurnContinuitySwap` = the bridge),
  yielding two NEW `ChatTurnEvent` kinds around the swap: `context-patching` → (swap) →
  `context-patched { toSessionId | null }`. Wired INSIDE the session-channel tee on every
  runner (`startChatTurn`'s new `continuity` input → workspace + DM streams; the global core;
  the three delegation runners), so SSE frames, the drain sink, observers, the feed step tap
  and the Watch channel all carry the state — no per-surface plumbing, and a new runner cannot
  forget it. `applyPrimaryTurnContinuityBestEffort` is gone (the wrapper owns best-effort).
- **Frame order on a swap:** `session-completed` → `context-patching` → `context-patched` →
  `turn-stream-ended`. The composer frees at `session-completed` (as before); the live chip /
  thread pill reads "patching context · Ns" (breathing gold) for the swap's seconds instead
  of a silent "done".
- **A turn arriving mid-swap:** the `turn-queued` sentinel now carries `{ reason:
  'context-patching' | 'busy' }` — read off a process-wide "swapping now" register
  (`continuity/swapping-primaries.ts`, marked/cleared by `bridgePrimarySession` in a
  try/finally); the workspace + DM streams check their identity's primary, the global SSE
  stream checks the brain pre-core. The note reads "Patching context — your message continues
  right after."
- **Signals:** `session.swapping` outbox event at swap start (a monitor can subscribe; not a
  state change, inserted on its own); feed steps `turn-context-patching` /
  `turn-context-patched` (contracts `SessionTurnStep`) — the activity store tolerates them;
  the web feed composable re-reads the session views on `turn-context-patched` (the head moved).
- **Web:** `ActiveTurnView.contextPatch { phase, fromSessionId, toSessionId }`; `LiveTurn`
  patching chip; `ThreadStream` "Patching context" pill; `use-chat-turn` + the DM
  `use-session-turn` `queuedReason`; the sidebar + session-thread notes per reason.
- **Voice completes at `session-completed`** (reviewer catch): the daemon used to complete a
  turn only on `turn-stream-ended`, which now arrives AFTER a boundary swap — the spoken reply
  would have queued behind tens of seconds of "thinking". Voice has no chip to show, so it
  frees the loop at the session's own end; the swap finishes server-side regardless (the
  abandoned stream's writes no-op).
- **Reviewer pass: 0 must-fix in the packages, 1 regression (voice, above) + 3 should-fixes
  taken:** the swapping mark lives INSIDE the bridge's try (an outbox-insert throw could have
  left a stale mark → every later park mislabelled), the DM web surface honors the queued
  reason, and the mark is now PINNED as held during the swap (observed from inside the distill
  by a subclassed fake). Recorded: `session.swapping` has no abort/failure sibling — a monitor
  can't tell "aborted" from "still swapping" (`session.swap-aborted` landed 2026-08-18 — see §6); the main GlobalChatView/WorkspaceView render no queued note at all (only the sidebar
  thread does) — pre-existing for "busy", inherited; the queued reason is one-shot at park
  time (a turn parked before the swap begins reads "busy" — the feed still narrates the swap).

## 5f. Slice 5 — SHIPPED 2026-08-18 (checkpoint + auto-continue)

- **Spike answer:** the SDK's `PostToolUse` hook returns `hookSpecificOutput.additionalContext`
  — text the model reads beside the tool result. That IS the mid-turn channel: a provider-owned
  hook (`packages/providers/src/claude/approvals/build-claude-post-tool-use-hook.ts`, the
  PreToolUse-backstop sibling) calls an `onToolResultContext(liveState)` callback with the turn's
  LIVE occupancy (`{ usedTokens, model }`, kept by `run-claude-chat-session.ts` from every
  `usage-reported` — input + cache-read + cache-creation) and injects whatever it returns.
  Subagent hook calls carry `agent_id` and are skipped (a subagent's context is not the turn's).
  The between-turns marker the plan mentioned is NOT built: a turn that ENDS over the threshold
  swaps at the boundary on its own — the nudge is a mid-turn-only concern.
- **The nudge (one home):** `continuity/context-nudge.ts` — `buildContextNudge({ threshold?,
  checkpointToolName? })` returns one turn's stateful callback: silent under the threshold in
  force (the same value the boundary swap uses — the env smoke knob included), speaks once on
  crossing ("CONTEXT CHECK (from Vynel, not the user): you have crossed 85% … (170k of 200k
  tokens; about 30k remain before the hard limit). Finish the slice you are on … call the
  `checkpoint` tool with the single next step, and end this turn with one line telling the user
  you will continue after patching context …"), then again only at every further +5% of the
  window ("still going: you are now at 91%"). Measured against the MODEL's window
  (`resolveContextWindow`) so a 1M model hears real headroom (140k), Haiku hears 30k. Armed by
  `startChatTurn` only when a `continuity` input is present (a plain conversation neither swaps
  nor continues), by the global core, and by the three delegation runners.
- **The tool:** `checkpoint({ nextStep })` — descriptor-owned on `vynel-session` beside
  `whoami` (every surface, never cards; catalog snapshot 135 entries, parity green). It marks
  the pending checkpoint on the turn's OWN identity (the compose-time primary id — never model
  input, so it cannot checkpoint another session), replies "Checkpoint noted … Now END this
  turn with one line …", and a plain conversation (no primary) is told plainly it cannot
  checkpoint. Register: `continuity/pending-checkpoints.ts` — process-wide map keyed by primary
  id (deliberate v1, no table: a minutes-scale intent between a turn's end and the swap that
  follows it in the same process; the tool call itself is already recorded on the chat row).
  `beginGenuineTurn` = a real turn starting: resets the runaway guard AND drops a stale
  checkpoint (a client that disconnected mid-turn would otherwise have its old "next step"
  hijack the next real message's turn); `takePendingCheckpoint` consumes exactly once;
  `beginContinuation` refuses past `MAX_CONSECUTIVE_CONTINUATIONS = 3`.
- **The carry gains a CHECKPOINT line** (`buildContinuityContext`, peeked never taken): "you
  stopped here to swap contexts, mid-task. The next step you named: …" — so the fresh context
  knows the cut even when the automatic continuation cannot run (cap reached, disconnect).
- **Auto-continue, interactive:** `runtime/run-turn-with-continuations.ts` — the ONE loop the
  interactive runners wrap their turn in: genuine turn → while a checkpoint is pending and
  under the cap → `runTurn(continuation)`. Each runner passes a `runTurn(continuation)` closure
  (only it knows how to start its kind of turn) that RE-RESOLVES the head for a continuation
  (the swap moved it): the workspace stream (`resolvePrimaryConversationTarget`), the DM stream
  (`findRoutableSessionById`), the global core (`deps.resolveTarget()`, extracted
  `runOneGlobalTurn`). One event stream, one SSE response, one activity turn: `… session-completed
  → context-patching → context-patched → user-message-persisted (the continuation's row) → …
  → turn-stream-ended` (pinned through the full HTTP stack in `chat-turn.test.ts` and on the
  core with real SQLite). `composeContinuationTurn` (`runtime/continuation-turn.ts`) is the one
  home for what a continuation says: the PERSISTED row "Continuing after patching context —
  next: <step>" stamped `sourceKind: 'global-root'` with NO label (renders as Claude continuing —
  a label would invent an origin chip; `deriveMessageOrigin` reads it as system-relayed, never
  the user), and the PROVIDER text ("This message is from Vynel, not the user … NEXT STEP …
  Do not restart finished work … if your context fills again, finish the slice and checkpoint
  again") — carried by `startChatTurn`'s new `providerUserMessageText` (the voice-marker
  precedent) + `messageAttribution`. Attachments ride the genuine turn only. A spurious
  checkpoint (turn under threshold) still continues — on the same head; harmless.
  **The terminal gate (reviewer catch):** a continuation runs ONLY after `session-completed` —
  a user Stop (`session-interrupted`) or a non-recoverable `session-errored` DROPS the pending
  checkpoint (logged): Stop always wins at terminal time, and a failing engine must not get
  three more turns fired into it. A recoverable error followed by completion counts as
  completed. `autoContinue: false` is the DELIVERY shape (the global root absorbing a child's
  report/update — `runGlobalRootTurn` passes it whenever `inboundAttribution` is set): no nudge
  armed, a stray checkpoint dropped, nothing continues — a delivery is never work.
- **Auto-continue, delegated:** `delegation/enqueue-checkpoint-continuation.ts` — the ticks call
  `beginDelegatedTurn` before the turn and `enqueueCheckpointContinuation` after a COMPLETED
  job: a same-shape follow-up job (same target, chain/threadId, mode/model/effort, channel
  origin, requester) whose task text is the SHORT anchor ("Continuing after patching context —
  next: …" — the runners persist task text verbatim, so both halves render the same row); the
  follow-up's id is remembered in the register (`markContinuationJob` / `takeContinuationJob`)
  so its claim reads as a CONTINUATION — the runaway guard keeps counting (reviewer catch: a
  plain row would have reset the guard on every hop and never capped) and the run gets the
  continuation steer (`CONTINUATION_TASK_INSTRUCTIONS`, the routed rules underneath). In-process
  like the checkpoints: after a restart the follow-up runs as a genuine turn (guard resets, the
  anchor row still names the step). FIFO on the target key claims it AFTER the swap that ran
  inside the finished turn. Kinds: task (workspace / spawned / colleague targets) and
  `agent-run` (`runAgentRunJob` — the colleague's own follow-up run via `enqueueAgentRun`; its
  `workspaceId` is the grounding, never the identity — the runner passes the resolved colleague
  id). A NOTE never continues (its checkpoint is dropped), and a DELIVERY (the report tick's
  workspace notify turn) arms no nudge (`armContextNudge: false`) and drops a stray checkpoint.
- **Web:** `ActiveTurnView.continuations[{ userMessage, atSegmentIndex }]` — a SECOND
  `user-message-persisted` on one stream re-opens the view (status streaming, error cleared,
  `contextPatch.phase = 'continuing'`); LiveTurn interleaves the anchor row (`MessageRow`)
  where its output begins (after all segments while none), the chip reads "continuing", the
  ThreadStream pill "<assistant> continuing"; overlay ids include the anchors (no double render
  on a mid-turn refetch); `use-chat-turn` retargets `activeSessionId` from the continuation's
  row so Stop interrupts the right segment. The Watch registry needs nothing: a continuation
  is a fresh turn on the (moved) head's channel, exactly like any swap.
- **Settings:** the continuation runs with the checkpointing turn's own settings (the same
  `turnSettings` closure / the same job columns / the same core input) — settled, see §4.6.
- **Tests (all real SQLite where the DB is involved):** nudge cadence/text/model window;
  register semantics (once, replace, cap, genuine reset, stale drop, per-identity);
  checkpoint tool responses; the loop (none / one / capped / stale); the composer via the loop;
  the delegated enqueue (workspace + session shapes, no identity, note, cap + reset);
  `startChatTurn` (nudge armed only with continuity; provider text vs persisted anchor);
  the global core end-to-end (three provider starts, one sink, the anchor row on B); the
  workspace stream end-to-end (one SSE response, order pinned); the tick end-to-end (follow-up
  job claimed and run with the instruction); the web fold + LiveTurn rows; catalog + descriptor
  pins; the PostToolUse hook + SDK options + live occupancy pins in providers.

## 6. Forks / deferred (decide deliberately, never slip in)

- **Swap-aborted signal — SHIPPED 2026-08-18 (`session.swap-aborted`):** every `session.swapping`
  now gets its end — `session.swapped` when it lands, `session.swap-aborted` (reason
  `no-usable-carry` | `failed` + the error message) when it does not, recorded best-effort in
  the bridge's finally beside the register clear. A monitor can tell "aborted" from "still
  swapping".
- **`McpToolFn` hoisted — SHIPPED 2026-08-18:** one home in `@vynel/mcp-contract`
  (`McpToolFn` + `McpToolContent`); the six package twins are gone.
- **`runContinuingTurn` — SHIPPED 2026-08-18:** the interactive streams' continuation dance
  (plain → one turn; continuing → genuine turn on the resolved head, each continuation on the
  re-resolved head, a vanished head skipped) lives once in the session package; the workspace
  and DM streams pass `startOneTurn` + `resolveHead`.
- **Identity-aware exclusion — SHIPPED 2026-08-18:** `get_chat_session` / `search_chat_messages`
  lift the global-scope wall for exactly one caller — the global root itself, resolved from the
  server-stamped turn-session header (`isTurnFromGlobalRoot`, beside the header module); a
  workspace turn, a spoofed/foreign id, or no header keeps the wall (route tests pin all four).
  The carry's recovery line and the `session-continuity` book now say so.
- **Slice 5 follow-ups (recorded, not built):** a durable checkpoint / continuation-job column
  if either ever has to survive a process restart (the register is in-process by design — a
  restart degrades to "the follow-up runs as a genuine turn"); the anchor row reads "after patching context"
  even on a spurious checkpoint that swapped nothing (Kafi's wording; the web shows no patch); the runners over ~300 lines (the streams grew with the loop closures) — split when the
  next change touches them.
- **Voice auto-continue — DEFERRED (Kafi, 2026-08-18):** a VOICE turn that checkpoints continues
  server-side, but the daemon frees at the first `session-completed` and the continuation's reply
  lands in the transcript unspoken. To build later: the daemon keeps reading past
  `session-completed` when a `context-patching` frame follows, speaks the continuation's text as a
  second utterance (mic stays with the assistant until `turn-stream-ended`), and the voice-turn
  marker tells the model a continuation on voice must stay short. Park with the voice work.

- **`.notes/` drafts are Kafi's working material** (Global Root, Workspace Manager, Workspace,
  Memory, Knowledge) — he completes and attaches them as duty books later. Do NOT polish,
  move, or publish them as part of this arc; the arc ships the BINDING only (§4.5). Build
  start is currently gated on another in-flight session — this doc is the ready plan.

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

## 8. Swap-risk punch-list (id-flow review, 2026-08-27 — cover later, own moves)

*From Kafi's id-lifecycle review. The id model itself verified sound: the primary id never
changes, the chain lives on the segment rows (`continuedFromSessionId`), never on the primary's
two pointer columns. The risks below are what the review surfaced around the swap — none blocks
today's behavior; each is a planned later move, not a slip-in.*

**R1 — Chain-blind delete resurrects a conversation's past (P1, verified).**
`DELETE /sessions/:sessionId` soft-deletes ONLY the head row
(`apps/local-api/src/routes/chat/index.ts:432` → single-row `softDeleteChatSession`). The fold
rebuilds from surviving rows (`packages/session/src/overview/fold-session-chains.ts:53`): the
pre-swap segments re-fold with the old tail, and a spawned/agent chain still holds its LISTED
origin row (only manager scopes hide first segments), so `hasListedSegment` admits the entry
again — the "deleted" conversation reappears, titled by its origin, showing pre-swap history.
Global/voice chains are admitted even all-hidden (the fold's scope exception), so the Assistant
entry re-admits its truncated chain the same way. Fix shape: deletion walks the chain — one
chain-delete op in chat, used by the route.

**R2 — Deleting a live identity's head strands the primary on a soft-deleted row (P1, verified).**
Nothing links a chat-session delete to `primary_sessions` (no route/op calls
`softDeletePrimarySession`; grep 2026-08-27). After deleting a spawned/agent conversation the
primary still points at the deleted row, and `findChatSessionById` does NOT filter `deletedAt`
(`packages/chat/src/repositories/chat-sessions.ts:52`), so the next turn resumes it and keeps
inserting messages into the soft-deleted row. After the 30-day purge, `hardDeleteChatSession` +
the `chat_messages` FK cascade (`chat-messages.ts:58`) silently delete everything written after
the user's delete — data loss on a still-active identity — and any newer segment chained to the
purged row is left with a broken link (see R3). Fix shape: product decision — deleting a segment
a primary points at either retires the identity (soft-delete the primary too) or is refused.

**R3 — Per-row purge vs loose-ref chain = permanent mid-chain gaps (P2).**
Segments purge independently by design (loose ref, no FK). A purged predecessor stops the
transcript walk (`resolve-primary-transcript.ts:71`) and the fold promotes the child to a head —
silent truncation presented as the full history. Invariant to pin when R1's chain-delete lands:
purge follows the chain, never outpaces it.

**R4 — Deletion rule differs per doorway (P2).**
`resolveSessionChainTranscript` throws for a deleted head; `resolvePrimaryTranscript` never
checks `deletedAt` (head or walked links) and happily renders one. Today's split is accidental —
pick one rule for every chain read (likely: deleted segments stay readable INSIDE a chain as
platform record; a deleted head reads per the R2 product decision).

**R5 — Orphan segment on crash between insert(B) and repoint (P3, accepted in-code).**
`bridge-primary-session-after-turn.ts:132` — separate transactions; the orphan is hidden, empty,
chained to A, and permanent (never listed, never purged). The fold's first-write-wins on two
claimants keeps the newest child, so it stays invisible. Cover with the recorded cross-domain-tx
follow-up.

**R6 — Swap-abort loop at the ceiling has no backoff or user signal (P2).**
A degenerate/failed distill aborts the swap and the primary stays on the near-full segment — so
EVERY later turn re-runs the full distill attempt (real tokens + latency on a ~200k session)
until one succeeds or SDK auto-compaction saves it. `session.swap-aborted` goes to the outbox
but no surface consumes it yet. Fix shape: consecutive-abort counter on the primary (the
`pendingCheckpointDepth` pattern) + set `problem` status after N aborts.

**R7 — Priming-timeout ghost sessions in runtime storage (P3).**
The timeout path interrupts and throws BEFORE `recordSwapSegmentSession`, leaving the primed
session (with a full carry copy) in the runtime's own storage, unreferenced by any Vynel row.
Repeats per retry. Hygiene note for the day storage size matters.

**R8 — `supersededFromSdkSessionId` is single-slot; never build on it (guard-rail).**
It records the LAST swap only and nothing reads it today. Any future hard-limit bridge derives
chains from the segment rows, never from this column.

**R9 — 200-message window, no paging (recorded deferral, chain angle).**
`resolvePrimaryTranscript` caps at the newest 200 messages across the chain (D16); on a long
chain the origin's messages are unreachable in the UI until paging lands. Data intact; UX gap.

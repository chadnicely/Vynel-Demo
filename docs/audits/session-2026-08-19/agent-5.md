# Vynel session-system audit — AGENT 5

Worktree `E:\KLONE\Workspace\vynel\.claude\worktrees\session-audit` @ `06781328` (`feature/session-audit`).
Entry point per brief: monitoring/UI → server truth, then widened to voice, delegation, continuity.

**Note on the worktree:** all five audit agents share this checkout. `git status` showed
`packages/session/src/delegation/audit-agent-3-timeout-lock.test.ts` (not mine — left alone).
My only artifact was `apps/local-web/src/stores/audit-agent-5-voice-leak.test.ts`, deleted at the end.

**Legend.** `NEW` = not in `.claude/STATE.md` / module notes. `KNOWN` = recorded there already
(judged and ranked, not re-discovered). CONFIRMED = traced end-to-end with line cites, or reproduced.

---

## 1. Bugs — Global · Workspace · Spawned · Agent · Voice · channels

### A5-01 · P1 · voice + global · NEW · A running VOICE turn hijacks the GLOBAL chat's continuing binding
**Where:** `apps/local-api/src/streams/global-root-turn.ts:321-325` · `apps/local-web/src/stores/activity-store.ts:61-77` · `apps/local-web/src/composables/chat/use-continuing-conversation.ts:47-71` · `apps/local-web/src/views/GlobalChatView.vue:114,118,197,219-226` · `apps/local-web/src/composables/chat/use-session-detail.ts:56-70`

The voice leg announces on the activity feed as a **global** turn with **no `primarySessionId`**:

```ts
// global-root-turn.ts:321
const activity = c.var.activityFeed.begin({
  userId: c.var.user.id,
  scopeKind: 'global',
  origin: input.voice === true ? 'voice' : 'web',
})           // ← no primarySessionId
```

`SessionActivityFeed.begin` defaults it to `null` (`packages/session/src/runtime/session-activity-feed.ts:108`),
and `BeginTurnActivityInput.scopeKind` is typed `'global' | 'workspace'` only (`:31`) — the feed
vocabulary has no `'voice'`. The client's "which session is this scope's primary turn on" reader is:

```ts
// activity-store.ts:64-67
for (const turn of Object.values(serverTurns.value)) {
  if (turn.sessionId === null) continue
  if ((turn.primarySessionId ?? null) !== null) continue      // spawned/agent skipped
  if (scope.kind === 'global' && turn.scopeKind === 'global') return turn.sessionId
```

A voice turn satisfies every clause, so it is returned as *the global scope's running primary session*.
`useContinuingSessionId` uses that as the fallback **and remembers it stickily**
(`use-continuing-conversation.ts:47-50, 66-71`), and `GlobalChatView` feeds the result straight into
`activeSessionId` → `useWatchedTurn` (live-channel subscribe) → `useSessionDetail(mode:'continuing')`.

**Failure scenario (CONFIRMED, reproduced) — no race needed:** a user who has never sent a *global*
message (fresh install; voice-first is exactly the persona this product targets) has
`root.getContinuing().currentSdkSessionId === null` **permanently** until they type in the global chat.
Say "hey Vynel" once and open the app. Then:
`activeSessionId` = the **voice segment id** → the window subscribes to `session:<voiceSegmentId>`
on the live channel and renders the voice turn's tokens as the global thread; `useSessionDetail`'s
continuing branch sees `transcript.session === null` and falls back to `root.getSession(voiceSegmentId)`
(`use-session-detail.ts:65-69`), which is owner-gated only — no scope fence
(`apps/local-api/src/routes/root/index.ts:307-330`) — so **the voice transcript renders inside the
global chat**. The stickiness (`lastRunningId`) means it survives the turn's end until a global turn
finally creates a head. This is the client-side hole in the cross-session wall the reviewer closed on
the server (chat-search, `/sessions/:id/messages`, `isTurnFromGlobalRoot`).
(A second, racier path exists on any app open while voice is speaking — the continuing query is
pending, so `data.value` is undefined and the same fallback fires — but the HTTP GET usually beats the
WS handshake→hello→subscribe→ack→replay, so I do not lean on it.)

**Repro (throwaway `audit-agent-5-voice-leak.test.ts`, ran green, then deleted):**
```
expect(store.runningPrimarySessionIdFor({ kind: "global" })).toBe("voice-segment-1")  ✓
```
(2 tests passed under `npx vitest run --project local-web`.)

**Minimal fix:** carry the identity on the wire instead of inferring it. Either (a) stamp
`primarySessionId: conversationTarget.primarySessionId` on the voice `begin()` — one line, and it
immediately excludes voice from `runningPrimarySessionIdFor` by the existing `primarySessionId !== null`
clause, plus it makes voice turns addressable in the feed; or (b) widen `BeginTurnActivityInput.scopeKind`
to include `'voice'` and fence every `scopeKind === 'global'` read. (a) is smaller and fixes A5-04 too.

---

### A5-02 · P1 · voice · NEW · A voice turn can park on an approval card no spoken surface can answer — and the daemon then goes permanently deaf
Traced hop by hop:

1. A daemon wake turn sends no `mode` (`apps/voice/src/brain/run-brain-turn.ts:100-107`), so
   `turnSettings.mode` is undefined (`global-root-turn.ts:150-161`; for voice the row is deliberately
   **not** read — `!isVoiceTurn && …` at `:152`), so `permissionMode` is undefined and the core falls to
   its default: `permissionMode: input.permissionMode ?? 'bypass-with-behavior-gate'`
   (`packages/session/src/runtime/run-global-root-turn-core.ts:202`).
2. `bypass-with-behavior-gate` **cards the static floor**:
   ```ts
   // tool-approval-policy.ts:109-111
   if (mode === 'bypass-with-behavior-gate') {
     return isAlwaysCardTool(toolName, sets) ? 'card' : 'allow'
   }
   ```
   floor = `Bash · Write · Edit · NotebookEdit`
   (`packages/providers/src/claude/approvals/tools-always-requiring-approval.ts:28-33`).
   Those native tools are **available** on the turn: `allowedToolNames: []`
   (`run-global-root-turn-core.ts:206`) and the SDK builder only sets `options.allowedTools`
   when the array is non-empty (`build-claude-sdk-options.ts:177-179`) — an empty allowlist restricts nothing.
3. The card parks the agent on an **unbounded** promise:
   ```ts
   // build-claude-can-use-tool-callback.ts:69
   const decision = await new Promise<ApprovalDecision>((resolve) => { … })
   ```
   `PendingApprovalRegistry` has **no timeout** — only `resolve()` and `cancelAllForSession()`
   (`packages/providers/src/shared/pending-approval-registry.ts:21-57`). The `'timed-out'` decision
   kind exists but nothing fires it.
4. The turn holds `runUnderRootTurnLock(`${userId}:voice`)` for its whole life
   (`run-global-root-turn-core.ts:93-94`) → every later voice turn queues behind it forever.
5. The **daemon** has no per-turn timeout or abort. `#runTurn` sets `#state = 'busy'` and only
   leaves via `#goActive()` after the brain stream terminates
   (`apps/voice/src/loop/voice-session-driver.ts:250-276`), and `pushAudio` drops all mic audio while
   busy (`:112`). `streamTurnEvents` uses a bare `fetch` with no `AbortController`
   (`run-brain-turn.ts:64-92`). **The daemon cannot even hear "hey Vynel" again — only a restart recovers it.**

**Concrete input → wrong outcome:** "Hey Vynel, how much disk space do I have?" → the brain runs
`Bash df -h` → card → the voice thread and the daemon both wedge indefinitely.

Also confirmed: nothing narrows the native toolset. The only restricting input the core passes is
`deniedToolNames: input.deniedMcpToolPatterns` (`run-global-root-turn-core.ts:207`), and that array is
built purely from feature descriptors' capability/tier-gated **MCP** tool names
(`apps/local-api/src/sessions/compose-session-mcp-servers.ts:70,99`) — `Bash` can never appear in it.

**Rescue path that exists (why this is P1 and not P0) — verified:**
`apps/local-web/src/components/shell/ApprovalNotifier.vue` polls `usePendingApprovals()` **unfiltered,
user-wide** and renders any pending card as a toast decidable on the spot from any view
(`:18,39-48,58-68`); the only filter is desktop-prefixed tools inside the Tauri shell (`:42`). The
approval row persists with `workspaceId: null`
(`packages/chat/src/turn-consumption/handle-approval-requested.ts:27-28,69`), so it also flips
`attention.global` (`use-workspace-status.ts:64-74`) and the shell's Global light reads `needs_input`.
So a user **with the desktop app open and visible** can unstick it. Two caveats worth carrying:
the hands-free / on-a-call user is by definition not looking at it, and
`contextLabelFor(null)` renders **"your assistant's own workspace"** (`ApprovalNotifier.vue:50-51`) —
a voice card, a call card and a global card are indistinguishable to the person deciding.

**Minimal professional fix:** the pattern already exists in this repo — routed leaves **fail closed**:
`buildRoutedLeafApprovalDenier` + `drainLeafTurn` throw on a carded tool because "a routed leaf has no
user to ask" (`packages/orchestration/src/leaf/drain-leaf-turn.ts:15,84`,
`create-leaf-session.ts:86-87`). Give the voice leg the same shape: when `input.voice === true` and no
card-capable surface is attached, deny the card with a spoken reason instead of parking. Belt-and-braces:
an `AbortController` + turn budget on `streamTurnEvents`, and a `busy`-state watchdog in the driver.

---

### A5-11 · P1 · voice (calls) · NEW · A live CALL session runs in `ask` — the MOST-carding mode in the system — on a surface with no card at all
**Where:** `apps/voice/src/call/call-session-client.ts:32-38` · `apps/local-api/src/streams/session-turn.ts:94-95` · `packages/chat/src/records/record-spawned-session-segment.ts:60-72` · `packages/providers/src/claude/approvals/tool-approval-policy.ts:112-122`

The per-call turn body sends **model and effort only** — no `mode`, and no `voice: true`:
```ts
// call-session-client.ts:33-37
return streamTurnEvents(`${apiUrl}/sessions/${sessionId}/turn`, {
  userMessageText: utterance,
  model: VOICE_MODEL,
  thinkingEffort: VOICE_THINKING_EFFORT,
})
```
A call session is a **spawned** session (`POST /sessions/spawned`, `:19-23`), and spawned sessions are
born with all four settings columns NULL (`record-spawned-session-segment.ts:60-72` never references
them — the recorded residual G3). So `streamSpawnedSessionTurn` resolves
`resolveTurnSessionSettings(input, row)` with `input.mode` undefined **and** `row.sessionMode` null,
then hard-defaults:
```ts
// session-turn.ts:95
const turnPermissionMode = toPermissionMode(turnSettings.mode ?? DEFAULT_SESSION_MODE)   // → 'ask'
```
Under `ask`, `decideCanUseTool` is *wider* than `bypass-with-behavior-gate`: the floor cards, the
ask-tier cards, composed-MCP tools resolve allow — but **native tools and external-server MCP tools
card** (`tool-approval-policy.ts:113-122`). `Read`, `Grep`, `Glob`, `WebFetch`, `Task` all card.

**Failure scenario:** Vynel is on a live call; a participant asks something that makes the model
`Read` a file. The turn parks on an approval nobody on the call can see, while holding the spawned
target lock (`session-turn.ts:263`) — so **every subsequent utterance in that call queues behind it
and the assistant goes silent mid-conversation**, with a human waiting on the line. Recovery is
A5-02's desktop toast, where the card is labelled "your assistant's own workspace".

Strictly worse than A5-02: a wider card set, a live human counterpart, and the voice pins deliberately
reach this leg (`VOICE_MODEL` / `VOICE_THINKING_EFFORT` are imported at `:2`) while the *mode* pin —
the one that would have prevented it — does not. **Minimal fix:** send an explicit non-carding mode on
the call body, or (better, and it fixes the class) birth-stamp spawned sessions with their creator's
settings *and* fail closed on cards for surfaces that declare no card capability.
**Confidence: CONFIRMED** — every hop read directly.

---

### A5-03 · P1 · voice · NEW (half KNOWN) · The voice thread has no status of its own — and a FAILED voice turn is invisible everywhere
`fold-session-chains.ts` drops every chain that is neither global-scoped nor has a *listed* segment:

```ts
// packages/session/src/overview/fold-session-chains.ts:68-69
const hasListedSegment = chain.some((segment) => segment.visibility === 'listed')
if (tail.scope !== 'global' && !hasListedSegment) continue
```

Voice segments are created hidden and scope `'voice'`
(`run-global-root-turn-core.ts:279-282`), so **no voice chain ever enters `getSessionsOverview`** —
not scoped, not unscoped. Consequences:

* `use-session-statuses.ts:77-85` never derives a status for the voice conversation; no Sessions row,
  no node, no sidebar entry, no `statusFacts`, no chain-wide `pendingApprovalCount`.
* **A FAILED voice turn produces `problem` nowhere.** `globalStatusView` reads the entry with
  `scope === 'global'` (`use-session-statuses.ts:90-95`) and `use-workspace-status.ts:126` derives
  `problem` from it. The voice chain is not in the overview at all, so a voice turn that errors
  (limit, engine unreachable, a failed turn) leaves **no red anywhere in the app** — exactly the
  invisible-limit-error class that Move 3's "BOTH global sinks now stamp 'failed'" fix existed to close,
  reopened for the new thread. This is the unrescued half and the reason this is P1.
* **Correction to my first reading, stated for honesty:** a *parked* voice turn does **not** read
  "running". `use-workspace-status.ts:124-132` checks `attention.value.global` (line 127) **before**
  the `running` branch (line 129), and a voice approval/ask persists with `workspaceId: null`
  (`handle-approval-requested.ts:27-28,69`) → `attention.global` → `needs_input`. The ONE-STATUS rule
  holds for parked voice turns; it is *failed* voice turns that fall through.
* Silver lining verified: `list_sessions` therefore does **not** leak the voice thread to workspace
  managers (I checked this specifically — the fold excludes it before `isSessionInScope` is consulted).
  And `send_message to:"session:<voice segment>"` 404s, because the routable lookup requires scope
  `'spawned' | 'agent'` (`packages/session/src/spawned/find-spawned-session-by-segment.ts:45-51`).
  The wall holds on the tool surface; it is the *status* surface that is missing.

**Fix:** either give the fold an explicit voice branch (`tail.scope !== 'global' && tail.scope !== 'voice'`)
and let `isSessionInScope` gate visibility per view (so the voice entry exists with facts but renders
only in the Voice-chat surface), or add a dedicated `statusFacts` read behind
`GET /root/voice-chat/continuing`. The first is smaller and restores one truth.

---

### A5-04 · P2 · monitoring · NEW · First-match-wins reads over a map that now legitimately holds two global-scope turns
`activity-store.ts:25-35`:
```ts
const hasGlobalServerTurn = computed(() => Object.values(serverTurns.value).some(t => t.scopeKind === 'global'))
const globalServerTurnOrigin = computed(() => Object.values(serverTurns.value).find(t => t.scopeKind === 'global')?.origin ?? null)
```
and `use-session-statuses.ts:51-56`, whose justification comment is now **false**:
> "Safe to claim: every OTHER global-scope turn on the feed is a spawned session's, and those always
> carry their session id from the start."

Three reads, and they are **not** all bugs — splitting them deliberately:

* **`runningPrimarySessionIdFor` (P2, a real behaviour bug):** returning the voice segment as the
  global scope's primary turn is what feeds A5-01. Reproduced: with a voice turn folded first and a
  global turn second, it returns `"voice-segment-1"`.
* **`hasGlobalServerTurn` / `globalServerTurnOrigin` (NOT a bug — recorded stance):** voice-session.md
  says explicitly *"Activity feed keeps `scopeKind 'global'` + origin 'voice' — the Global node's live
  dot still covers speech (the voice area lives under Global)."* So global liveness covering speech is
  intended. The only residue is that `globalServerTurnOrigin` is first-match-wins over a map that can
  now hold both, so the indicator copy may name the wrong origin when the two run together
  (reproduced: `globalServerTurnOrigin === 'voice'` while a web turn also runs). **P3, cosmetic.**
* **`use-session-statuses.ts:49-50` (P3, a stale invariant comment):** *"Safe to claim: every OTHER
  global-scope turn on the feed is a spawned session's, and those always carry their session id from
  the start."* False since `939cef22`. The behaviour it guards (the Assistant entry claiming a
  null-session global turn's start time) now also claims voice turns — harmless under the recorded
  stance, but the comment is the kind of thing a future reader would rely on.

STATE.md records that the reviewer fixed exactly this class at *one* call site ("an exact voice-turn
poll signal — find-first-global could miss a voice turn now that the lock split allows global+voice
concurrently", implemented at `VoiceChatPanel.vue:42-46`). **The fix was applied pointwise, not as a
vocabulary.** Fix: same as A5-01(a) — stamp `primarySessionId` on the voice begin, and/or add
`scopeKind: 'voice'` so every reader must decide explicitly; then correct the comment.

---

### A5-05 · P3 · restart/observability · NEW · The durable-turn "rebuild seed" has zero consumers
`GET /activity/running` — *"The durable in-flight turns — the refresh/restart rebuild seed"*
(`apps/local-api/src/routes/activity/index.ts:85-114`) is called by **nothing**. The generated SDK
does expose it (`packages/sdk/src/generated/namespaced.ts:31-32`, `listRunningTurns`), but a
repo-wide grep across `apps/` and `packages/` (`.ts`, `.vue`, `.rs` — local-web, desktop, voice, cli,
worker) finds no caller outside the route and the generated method itself.
The client seeds `serverTurns` only from the live channel's in-memory replay
(`SessionActivityFeed.subscribe`, `session-activity-feed.ts:172-183`). So the whole `session_turns`
durability story (`insertSessionTurn` / `reapOrphanedSessionTurns` at boot,
`apps/local-api/src/boot.ts:304`) exists for a rebuild nobody performs. Boot reaping is correct and
does prevent ghosts *in the DB*; the stated purpose is simply unfulfilled. Either wire it (it is the
only thing that makes a mid-turn API restart visible to an already-open window) or stop calling it
the rebuild seed.

---

### A5-06 · P3 · workspace · NEW · `continueEnabled: false` silently drops BOTH continuity and the single-writer lock
`chat-turn.ts:142` `const isContinueActive = input.continueRoot === true && c.var.workspace!.continueEnabled`.
That one flag gates three separate things: the primary target (`:216`), the `continuity` object handed
to `startChatTurn` — hence the boundary swap **and** the context nudge (`:292-299`) — and the
`SessionTargetLocks` acquisition (`:475-478`, early return with no lock). The column defaults `true`
(`packages/db/src/schema/workspaces/workspaces.ts:45`) and is settable through
`PATCH /workspaces/:workspaceId` (`apps/local-api/src/routes/workspaces/index.ts:414-440`). It has
**no UI** (`grep continueEnabled apps/local-web/src` → nothing) and **no `x-mcp`** on that route, so it
is not agent-reachable — which is why this is P3 and not P1. But if it is ever flipped (API client,
future setting), that workspace silently loses amnesia protection and its writer lock with no way back
through the app. Worth an invariant: continuity should not be gated on the same flag as "one continuous
thread" UX.

---

## 2. Where a session can get STUCK

| # | Stuck point | How | Recovery | Evidence |
|---|---|---|---|---|
| S0 | **Live CALL turn on an approval card** | the call leg resolves `'ask'`, where *native* tools card too; unbounded `await`; the spawned target lock is held, so every later utterance in the call queues behind it | only the desktop toast; the call itself goes silent | A5-11 — CONFIRMED |
| S1 | **Voice wake turn on an approval card** | floor tool under `bypass-with-behavior-gate`, unbounded `await` | none from voice; only the desktop app's approval queue, or restarting the daemon | A5-02 — CONFIRMED |
| S2 | **Voice daemon `busy` forever** | `#state='busy'` cleared only on a brain terminal; `pushAudio` drops all audio while busy; no fetch abort, no turn budget | restart the daemon | `voice-session-driver.ts:112,250-276`; `run-brain-turn.ts:64-92` — CONFIRMED |
| S3 | **Channel (Telegram) turn on an approval card** | same class as S1 — `runGlobalRootTurn` also defaults to `bypass-with-behavior-gate`; the channel user cannot see a card | the desktop app's queue | same policy cites — CONFIRMED (same code path) |
| S4 | **Global root lock held by a parked turn** | `runUnderRootTurnLock` is a promise-chain serializer with **no timeout** (`root-turn-lock.ts:24-33`); a parked S1/S3 turn blocks every later global turn *and* every global report-delivery job | resolve/cancel the approval, or restart | CONFIRMED |
| S5 | **Global report-delivery burns a pool slot while blocked on the root lock** | a global-requester delivery holds `GLOBAL_ROOT_DELIVERY_TARGET_KEY` in the bounded pool **and** waits on `runUnderRootTurnLock(userId)` inside the core. A long/parked global chat turn stalls it for up to the 600 s budget | `DELEGATION_RUN_BUDGET_MS = 600_000` (`run-delegation-claim-and-run-tick.ts:81`) eventually frees the slot; the job then settles failed | CONFIRMED (two lock mechanisms, `delegation-service.ts:194` + `run-global-root-turn-core.ts:94`) |
| S6 | **Timeout ≠ cancel** | the budget bounds *waiting*, not the turn: on timeout the SDK session keeps running while the target lock is released in `.finally` (`delegation-service.ts:204-225`), so a second run on the same target can start beside a still-live first one | none | PLAUSIBLE (another agent is testing this specific interaction) |
| S7 | **Restart mid-run** | handled well: `failOrphanedClaimedDelegations` + `requeueOrphanedClaimedReportDeliveries` + a per-orphan failure push at boot (`delegation-service.ts:117-158`), and `reapOrphanedSessionTurns` (`boot.ts:304`) | automatic | CONFIRMED — this is a strength |
| S8 | **Process-wide registers vs restart** | `pendingByPrimaryId`, `continuationDepthByPrimaryId`, `continuationJobsById` (`pending-checkpoints.ts:28,29,97`) and `swappingPrimaryIds` (`swapping-primaries.ts:10`) are in-memory. A crash mid-swap loses the "patching" sentinel; a crash between checkpoint and continuation loses the next step | documented + deliberate; the anchor row still names the step | KNOWN, correctly reasoned in the file headers |
| S9 | **Client detach/watch** | the origin POST aborts once `hasSharedFold`; if the live socket then drops before the turn ends, `onDetached` clears the fold and the re-ack reseeds — but if the socket never reconnects (`scheduleReconnect` returns early when `channels.size === 0`, `live-channel-store.ts:197`) the composer sits with no overlay | the transcript poll (`hasUnrenderedGlobalTurn`, 4 s) still lands rows | PLAUSIBLE |
| S10 | **Continuation loop** | correctly capped: `MAX_CONSECUTIVE_CONTINUATIONS = 3`, terminal-gated, stale checkpoints dropped on a genuine turn (`run-turn-with-continuations.ts:63-100`) | n/a | CONFIRMED — a strength |

One thing I checked and can clear: a client abort mid-turn does **not** lose the boundary swap.
`withBoundaryContinuity` runs the swap *after* its inner `for await` and inside the generator body
(`with-boundary-continuity.ts:62-82`), so a consumer that throws would abandon it — but Hono's
`StreamingApi.write` swallows every write error (`hono@4.12.27/dist/utils/stream.js`, `write()`'s
bare `try/catch`), so `sink.onEvent` never throws and the loop always reaches the swap. The voice
daemon's deliberate early `return` at `session-completed` (`run-brain-turn.ts:88`) is therefore safe.

---

## 3. Do modes, models, effort, buildout bind and carry to children?

**Resolution rule** (`packages/chat/src/settings/resolve-turn-session-settings.ts`, used identically by
all three interactive streams): `input ?? row ?? surface default`.

Columns (all four nullable, `packages/chat/src/schema/chat-sessions.ts:105-111`):
`sessionMode` · `selectedModel` · `thinkingEffort` · `autoBuildout`.

| Path | mode | model | effort | buildout | Source of truth | Verified by |
|---|---|---|---|---|---|---|
| Global web turn | `input ?? row`, else core default **`bypass-with-behavior-gate`** | `input ?? row` | `input ?? row` | write-through only | `global-root-turn.ts:150-161`, core `:202` | read |
| **Voice** (daemon wake / call client / web overlay / panel typing) | `input` **only** (row never read `:152`, never written `:338`) → **`bypass-with-behavior-gate`** | `input` = `VOICE_TIER_MODEL`, then `fitPinnedModelToSession` clamp `:183` | `input` = `VOICE_TIER_THINKING_EFFORT` | n/a | `global-root-turn.ts:129,150-155,181-195,332-340` | read |
| Workspace chat | `input ?? row ?? DEFAULT_SESSION_MODE` = **`'ask'`** | `input ?? row` | `input ?? row` | row (inert) | `chat-turn.ts:112-119` · `session-mode.ts:77` | read |
| Session DM (spawned/agent) | `input ?? row ?? DEFAULT_SESSION_MODE` = **`'ask'`** | `input ?? row` | `input ?? row` | row (inert) | `session-turn.ts:94-95` | read |
| Channel / non-interactive global | no mode field exists on the input at all → **`bypass-with-behavior-gate`** | passthrough | adaptive | n/a | `sessions/run-global-root-turn.ts` → core `:202` | read |
| Delegated child (task) | `x-vynel-delegation-mode` → job `permissionMode`; NULL → `bypass-with-behavior-gate` | job `model` (agent paths backfill `agent.model`) | job `thinkingEffort` | n/a | `enqueue-{workspace,session}-delegation.ts:96-98/111-113`; readers `run-delegation-claim-and-run-tick.ts:485-503` | traced |
| **agent-run job** | job `permissionMode` | `claimed.model ?? agent.model` | **structurally always NULL** — `enqueueAgentRun` has no effort input (`enqueue-agent-run.ts:99-101`) | n/a | reader `run-agent-run-job.ts:270-276` reads it uniformly as if it could vary | traced |
| **note delivery** | job `permissionMode` | **always NULL** (no field) | **always NULL** (no field) | n/a | `enqueue-note-delivery.ts:99-101` | traced |
| Report/update delivery turn | always NULL → unattended default; `autoContinue:false`, `armContextNudge:false` | always NULL | always NULL | — | `enqueue-report-delivery.ts:107-109` · `enqueue-update-delivery.ts:112-114`; `run-report-delivery-tick.ts` reads none of the three | traced |
| Leaf (by-reference) | **hardcoded** `bypass-with-behavior-gate`, input ignored by design | `options.model ?? agent.model` | no field on this path | n/a | `packages/orchestration/src/leaf/map-agent-to-leaf-input.ts:34,46` · `push-to-session.ts:36,39` | traced |
| Checkpoint follow-up job | copy-forward from the parent job | copy-forward | copy-forward **except the agent-run branch**, which drops it | copy-forward n/a | `enqueue-checkpoint-continuation.ts:142-143,158-183` | traced |
| Continuation turn (interactive) | the row's **current** settings (shipped default; open call recorded) | same | same | same | `run-turn-with-continuations.ts` | KNOWN |
| Swap segment | copy-forward | copy-forward | copy-forward | copy-forward | `record-swap-segment-session.ts:102-112` · `handle-session-started.ts:147-157` (**compaction-swap branch only**) | traced |
| **Spawned session at birth** | **NULL** | NULL | NULL | NULL | `record-spawned-session-segment.ts:60-72` never references them | traced |
| **Leaf session row at birth** | **NULL** | NULL | NULL | NULL | `record-leaf-session.ts:49-66` never references them | traced |

No `UPDATE` anywhere rewrites the three job columns post-insert — every repository export in
`packages/orchestration/src/repositories/delegation-jobs.ts` was checked. A chain hop only ever gets
new values from a fresh row. That is a good invariant; worth pinning with a test.

### Gaps

* **G0 · P2 · NEW — the two interactive families disagree on the "user never picked anything" default.**
  A brand-new **workspace** or **DM** thread resolves `DEFAULT_SESSION_MODE = 'ask'`
  (`chat-turn.ts:119`, `session-turn.ts:95`, `packages/session/src/session-mode.ts:73-77` — *"explicit
  opt-in to autonomy"*). A brand-new **global** thread leaves the mode `undefined` all the way down to
  `run-global-root-turn-core.ts:202`, which resolves **`bypass-with-behavior-gate`** — the *unattended*
  default, documented for "schedules, delegated leaves, report delivery"
  (`tool-approval-policy.ts:20-23`). So the assistant surface with the widest toolset (routing, desktop,
  ssh, notebook, plus all native tools) is the one that starts least-carding, from the identical
  starting condition, for a product whose doctrine is a card on every irreversible action. Whether
  intended or drift, it is not written down anywhere as a decision. **Fix:** either resolve
  `DEFAULT_SESSION_MODE` at the global stream too, or record the asymmetry explicitly in
  `session-mode.ts` beside the constant that claims to be *the* default.

* **G1 · P2 · NEW — the Voice chat panel's composer chips write a settings row the voice surface never
  reads.** `VoiceChatPanel.vue:198-202` passes `:session-id="headSessionId"` (the voice head) to
  `AppComposer`, which runs `useSessionSettings(props.sessionId, props.settingsDefaults)`
  (`AppComposer.vue:97-99`); a chip change **PATCHes the voice `chat_sessions` row**
  (`use-session-settings.ts:10-22`). The server then ignores that row for every voice turn
  (`global-root-turn.ts:152` passes `null` for the row when `isVoiceTurn`). Net: the chips affect only
  *typed panel* turns (because `AppComposer` emits the values with the send and the server honors raw
  input); a wake-word, call, or overlay turn silently runs the pins + the core default. The user sees a
  persisted-looking setting that does nothing. **Fix:** make the voice composer's chips local-only
  (pass no `sessionId` and use `settingsDefaults` as the whole source), or make voice read the row and
  close A5-02 first so an `ask` row cannot hang a card-less surface.
* **G2 · P2 · NEW — the voice panel supplies `modelId` + `thinkingEffort` surface defaults but not
  `mode`** (`VoiceChatPanel.vue:199-202`), so a typed voice turn's mode falls through to the ui-store's
  new-chat default — which may be `ask`. First typed message in the panel can card. Survivable (the
  panel renders and answers cards, `:111-124,172`) but inconsistent with "voice never cards".
* **G3 · KNOWN, still open — spawned sessions are born with NULL composer settings**, so a DM to a
  child of an `auto` parent defaults to `ask`. I agree this is the right next fix: birth-stamp the
  creator's resolved settings in `create-spawned-session.ts`. Rank: **2nd** of the recorded residuals.
* **G4 · KNOWN, still open — no fit guard on a delegated small-model pick onto a fat target.**
  `fitPinnedModelToSession` is called from exactly one site (`global-root-turn.ts:183`, voice only).
  The same class is reachable from `delegate-to-*`. Rank: **1st** of the recorded residuals — it is the
  *same* incident class that produced the 2026-08-19 crash, just on a different runner.
* **G5 · P3 — one home for the voice tier is real and good.** `VOICE_TIER_MODEL = 'claude-sonnet-5'` /
  `VOICE_TIER_THINKING_EFFORT = 'low'` live in `packages/contracts/src/chat/voice-tier.ts:14-15` and
  **four** legs import it: the daemon wake line (`apps/voice/src/brain/run-brain-turn.ts:51-55,103-105`),
  the web overlay (`apps/local-web/src/composables/voice/use-voice-session.ts:5-7,46-48`), the per-call
  session client (`apps/voice/src/call/call-session-client.ts:2,35-36`), and the Voice chat panel's
  composer defaults (`VoiceChatPanel.vue:20-22,199-202`). Answer to the brief's "three pins — one home?":
  **yes, one home, and it is actually four legs.**
* **G6 · P3 — `thinkingEffort` is structurally dead on two job kinds.** `enqueueAgentRun`
  (`enqueue-agent-run.ts:99-101`) and `enqueueNoteDelivery` (`:99-101`) hardcode it null with no input
  field able to set it, and the agent-run branch of `enqueue-checkpoint-continuation.ts:159-168` drops
  it on the follow-up too — yet `run-agent-run-job.ts:270-276` reads `claimed.thinkingEffort`
  uniformly as if it could vary. So an agent run delegated by a high-effort parent silently runs at the
  adaptive default. Either add the field or delete the read.
* **G7 · P3 · KNOWN-and-deliberate — `autoBuildout` is inert by design, not by accident.** I chased it
  end to end (chip → `use-chat-turn.ts:182` → all three request schemas → `persistTurnSessionSettings`
  → swap copy-forward → `GET /settings`) and **no turn runner reads it**: it is not even in
  `resolveTurnSessionSettings`'s type. That is stated on purpose —
  `apps/local-web/src/stores/ui-store.ts:121` says *"NOTHING READS IT YET (Kafi …)"* and every schema
  comment says "write-through persistence only". Reporting it as a placeholder, not a bug — but it is
  a live user-facing toggle that does nothing, which is worth a disabled state or a tooltip.

---

## 4. Places we missed that can be improved

1. **The feed's scope vocabulary is two-valued while the system is five-scoped.**
   `BeginTurnActivityInput.scopeKind: 'global' | 'workspace'` (`session-activity-feed.ts:31`) forces
   voice, spawned and agent turns to masquerade as one of the two, and every client reader then
   re-derives identity from `primarySessionId ?? null` heuristics. A5-01 and A5-04 are both symptoms.
   Widening the enum once is cheaper than fencing N readers.
2. **`SessionTurnRecorder` has no failure surface.** The interface says implementations "OWN their
   failure handling (log, never throw)" (`:49-52`); the feed calls it fire-and-forget. A silently
   failing recorder makes both the boot reap and `/activity/running` lie, with no signal.
3. **Two different "is a turn running" truths** — the in-memory `SessionActivityFeed` (what the UI
   sees) and `session_turns` (what the DB says). Nothing reconciles them; the one route that could
   (`/activity/running`) is dead (A5-05).
4. **No invariant test that every runner is covered by continuity.** The coverage is real today (see
   §6) but nothing fails if a sixth runner lands without `withBoundaryContinuity`. A census-style test
   over `consumeSessionEventStream` call sites (there are exactly 5, matching the 5
   `withBoundaryContinuity` sites 1:1) would pin it the way the MCP parity guards pin tools.
5. **Approval waiting has no bounded mode anywhere.** `PendingApprovalRegistry` is the single home and
   has no timeout; every card-less surface (voice, channels, delivery turns) inherits an unbounded park.
   A `deny-after(ms)` policy per surface kind would close S1/S3/S4 as a class rather than per surface.
6. **`useProjectNodes` filters a shared capped list client-side** — see A5-07 — while
   `useSessionsLibrary` documents exactly why that is wrong (`use-sessions-library.ts:16-18`). One of
   the two is right; the duplication is the smell.
7. **Stale invariant comments are load-bearing here.** `use-session-statuses.ts:49-50`,
   `constellation-scene.ts:31` ("`problem` is the one state nothing feeds here yet" — it does now),
   `constellation-layout.ts:34-36` (points at `composables/nodes/fleet-node-status.ts`, which no longer
   exists). In a codebase this comment-dense, a wrong comment is a bug report waiting to be believed.
8. **`routes/root/index.ts` at 503 lines** — KNOWN, and the two voice doors are the obvious extraction.

---

## 5. Monitoring binding + node display

**My interpretation:** I answer both readings, (a) the Nodes constellation view, (b) the wider live
binding — because the brief asks and because the two share the same root cause (no adapter layer
between session truth and the display vocabulary).

### (a) The Nodes constellation — is it bound to real truth, and can it be enlarged?

**Bound to real truth: yes, and this is genuinely good.** `resolveNodeStatus`
(`composables/nodes/node-status.ts:25-41`) is a *pure rename* of the app's ladders into the scene
palette — the fleet dots take `use-workspace-status`, the project dots take `deriveSessionStatus` via
`use-session-statuses`. Nothing is invented; the file's own header records the "NEEDS YOU as an ELSE
branch" bug that this replaced. `hasAnswered` gates painting until the polls answer. That is a correct
one-truth binding.

**Enlarged easily: no.** Concretely:

* **A5-07 · P2 · NEW — the project level under-reports sessions.** `useProjectNodes` reads the *shared,
  unscoped, 50-capped* overview and filters client-side:
  ```ts
  // use-project-nodes.ts:24 then 68-69
  const sessionsQuery = useSessionsOverview(() => id.value !== null)   // vynel.sessions.overview() — no args
  for (const row of sessionsQuery.data.value ?? []) { if (row.workspaceId !== workspaceId) continue; … }
  ```
  `useSessionsOverview` calls `vynel.sessions.overview()` with no params (`use-sessions-overview.ts:17`)
  → server `DEFAULT_ENTRY_LIMIT = 50` (`get-sessions-overview.ts:40`). The route **supports**
  server-side scoping and paging (`apps/local-api/src/routes/sessions/index.ts:120-135`) and
  `useSessionsLibrary` uses it precisely because "filtering client-side would hand a page of 50
  mixed-scope entries to a drilled room and yield three rows" (`use-sessions-library.ts:16-18,34-40`).
  So a busy user drills into a project and sees a *subset* of its sessions, with no indication.
  **Fix:** give `useProjectNodes` its own scoped read (`{scope:'workspace', workspaceId}`), reusing
  `useSessionsLibrary`'s query.
* **A5-08 · P2 · NEW — the scene's node vocabulary cannot carry more information.**
  `SceneNode = { id, name, initials, status }` (`constellation-scene.ts:19-25`). There is no scope, no
  kind, no parent, no counts, no context occupancy — so "more info per node" means widening the type
  and touching a 787-line canvas engine that iterates `nodes` at ~10 sites (`:177,178,225,240,257,273,296,336,555,590,616,643`).
  Worse, node **identity is stringly typed**: `continuing:<workspaceId>` / `session:<sessionId>` minted
  in `use-project-nodes.ts:59,71` and parsed back with `startsWith`/`slice` in `NodesView.vue:88-92`
  and `message-scene-mapping.ts:60-64`. Each new level needs another prefix and another parser. There
  is no `SceneNode` adapter — each level hand-builds its own list.
* **A5-09 · P2 · NEW — the layouts are index-linear with no clustering, paging, or level-of-detail, so
  they degrade at single-digit node counts.** Orbit gives each node its own lane, growing without bound:
  ```ts
  // constellation-scene.ts:224
  const lane = (i) => Math.min(W * 0.46, H * 0.47) * (0.3 + 0.115 * i)
  ```
  The ellipse is `(lane, lane * 0.82)` centred at `H/2`, so on a 1600×900 stage
  (`min = H*0.47 ≈ 423`) the vertical semi-axis passes `H/2` around `i ≈ 9` and nodes start leaving the
  viewport there; the horizontal edge holds until `i ≈ 14`. Rise clamps x to `[80, W-80]`
  (`:243-245`), so past ~15 nodes overlap outright. Constellation puts every node on **one** ring
  (`:257-263`), so labels collide much earlier than that. "More nodes without perf/binding pain" fails
  on **layout**, not on binding, in the high single digits — and the failure mode is silent.
* **Only two levels, and the global half of the product is absent.** Fleet = workspaces only
  (`use-fleet-nodes.ts:23-30` over `dashboard.overview().workspaces`). There is no node for the Global
  assistant thread, no node for the voice thread, no third level for spawned sessions / agent runs /
  tasks. `NodesView.onNodeClick` hard-codes the two-level meaning (`:138+`).
* **A5-10 · P3 · NEW — message arcs lose a swapped chain.** `projectMessages` maps an endpoint to the
  build node only when `sessionId === input.continuingSessionId` — the *current head*
  (`message-scene-mapping.ts:60-65`, fed by `use-project-nodes.ts:92-94`). After a context swap, any
  edge whose endpoint is a pre-swap segment of the same conversation silently drops. Should map over
  the chain's whole segment set (the overview entry already carries `segments`).

**What to change, minimally, to make it enlargeable:** (1) a real `SceneNodeRef` discriminated union
(`{kind:'workspace'|'session'|'agent-run'|'task'|'global'|'voice', id}`) instead of prefixed strings,
minted and parsed in one place; (2) one `useSceneLevel(level)` adapter that maps *any* level's domain
rows into `SceneNode`s, so a third level is a new mapper, not a new hand-built list; (3) widen
`SceneNode` with an optional `detail` bag the renderer may ignore; (4) make the layouts count-aware
(rings, or a radius that divides by `n`).

### (b) The wider live-monitoring binding

**Where it is one truth (strengths):** the live channel is genuinely one socket per window with
refcounted channels (`live-channel-store.ts`), the registry is one fold per session shared by all
consumers with generation guards against stale seeds/settles (`live-turn-registry.ts:102-107,169-189,229-243`),
the status ladder has exactly two homes (`deriveSessionStatus`, `deriveView`) and everything else
renames them, and ownership on session/trace channels is answered from the DB per subscribe
(`apps/local-api/src/live/live-channel-route.ts:39-54`, hub `:230`) — so the wall holds on the socket
too (I checked this third direction specifically).

**Where it drifts / double-derives:**

* Voice is invisible to the whole status half (A5-03) while being *over*-visible to the liveness half
  (A5-01, A5-04). That asymmetry is the biggest single binding defect right now.
* Two derivations of "the global thread's status" coexist: `use-session-statuses.globalStatusView`
  (facts-based) and `use-workspace-status.globalStatus` (which layers `hasGlobalServerTurn` and the
  polled attention on top, `:124-132`). They agree today only because the precedence happens to match.
* `liveTurnStartedAtForEntry`'s "assistant pre-resolution window" special case
  (`use-session-statuses.ts:51-56`) is a heuristic over a feed that no longer supports it.
* Agent-run panes are bound to the *spawning tool call* inside a host session
  (`conversation-sidebar-store.ts:21-29`), not to a session identity — reasonable, but it means an
  agent run has no row in any list and no status; it exists only if you find its pointer.
* Nothing surfaces the SDK's `system/api_retry` frames, so a 100 s retry reads as idle everywhere
  (KNOWN follow-up, still not built — I'd rank it high for perceived reliability).

---

## 6. Session continuity everywhere

Coverage verified across every runner. The `withBoundaryContinuity` census is my own grep, not a
delegated read — exactly 5 production sites, and they are 1:1 the 5 `consumeSessionEventStream` sites:
`run-global-root-turn-core.ts:297` · `start-chat-turn.ts:250` · `delegate-to-workspace-root.ts:234` ·
`delegate-to-spawned-session.ts:256` · `delegate-to-agent-session.ts:221`.

| Runner | pressure→swap | carry (`buildContinuityContext`) | nudge | auto-continue | lock |
|---|---|---|---|---|---|
| Global web turn | ✅ `run-global-root-turn-core.ts:297` | ✅ via swap | ✅ `:233` | ✅ `runTurnWithContinuations` `:103` | `userId` |
| **Voice turn** | ✅ same core | ✅ | ✅ | ✅ | `${userId}:voice` |
| Global channels / non-interactive | ✅ same core | ✅ | ✅ (off on notify turns) | ✅ (off on notify) | `userId` |
| Report / update delivery | ✅ (via `delegateToWorkspaceRoot` or the global core) | ✅ | ❌ by design (`armContextNudge:false`) | ❌ by design | delivery target key **+** root lock |
| Workspace chat | ✅ via `startChatTurn` — **only when `isContinueActive`** | ✅ | ✅ same gate | ✅ `chat-turn.ts:360` | `workspaceId`, same gate |
| Spawned-session DM | ✅ unconditional (`session-turn.ts:310-313`) | ✅ | ✅ | ✅ `:369` | `spawned.id` |
| Delegate → workspace-root | ✅ `:234` | ✅ | ✅ `:173` | queue-based (`enqueueCheckpointContinuation`) | pool target key |
| Delegate → spawned | ✅ `:256` | ✅ | ✅ `:184` | queue-based | pool target key |
| Delegate → agent session | ✅ `:221` | ✅ | ✅ `:167` | queue-based (`run-agent-run-job.ts:327`) | pool target key |
| Agent-run job | ✅ via the above | ✅ | ✅ | ✅ | pool target key |
| Monitor tick | n/a — runs **no** turn, only enqueues (`run-monitor-tick.ts:221,238,252`) | — | — | — | — |
| **Schedule fire** | ❌ **none** — `fire-schedule.ts:131-157` calls `startChatTurn` with **no `continuity`** | ❌ | ❌ | ❌ | ❌ no lock | 
| **Leaf sessions** | ❌ none — `drainLeafTurn`, not `consumeSessionEventStream` | ❌ | ❌ | ❌ | ❌ |

**Judgement on the two ❌ rows:** both are *correct by construction*, not gaps. Schedules always start a
**fresh** session per fire (`fire-schedule.ts:130`), so there is no continuing identity to measure; leaves
are one-shot by-reference sessions that hardcode `bypass-with-behavior-gate`
(`map-agent-to-leaf-input.ts:34`, input deliberately ignored) and **fail closed on a card**
(`packages/orchestration/src/leaf/drain-leaf-turn.ts:15,84`), dying with their turn. I checked both
before claiming a gap. Two things I would add: an assertion/comment so a future "make schedules
resume" change cannot silently ship without continuity, and a census test binding
`consumeSessionEventStream` call sites 1:1 to `withBoundaryContinuity` sites (they match exactly today,
5 and 5) so a sixth runner cannot land uncovered.

### Where continuity can still break

* **C1 · P2 · NEW — the workspace path's continuity is gated on a mutable column.** See A5-06:
  `continueEnabled: false` removes swap + nudge + lock in one flag.
* **C2 · KNOWN — process-wide registers vs restart.** Correctly documented (`pending-checkpoints.ts:6-11`);
  a restart between checkpoint and continuation loses the intent but not the anchor row.
* **C3 · NEW observation — global + voice now swap concurrently, and `swapping-primaries` is keyed by
  primary id**, so the two never collide (different primaries). Good. But
  `isPrimarySwapping(conversationTarget.primarySessionId)` in `global-root-turn.ts:345` is read
  **pre-lock**, so a swap that starts between the read and the acquire shows no `turn-queued` reason —
  a cosmetic race, not a correctness one.
* **C4 · NEW — the voice thread's no-write rule vs copy-forward.** Voice never persists settings
  (`global-root-turn.ts:338-340`) but the *panel* does (G1), and a voice swap segment copies those
  forward. So the voice chain accumulates settings that only typed turns honor. Harmless today,
  confusing later.
* **C5 — the carry is own-chain only and owner-gated** (`build-continuity-context.ts`), and voice
  segments inherit scope from their predecessor, so a voice swap reads its own predecessor. Verified
  the wall lets that happen: `isTurnFromGlobalRoot` accepts both `global` and `voice`
  (`apps/local-api/src/routes/sessions/index.ts:249-251`). Correct.
* **C6 · P2 — `<synthetic>` / zero-usage poisoning is fixed at the translator** (STATE-recorded), but
  `fitPinnedModelToSession` is still wired to exactly one call site. See G4.

---

## 7. Score

**6 / 10.**

| Dimension | Score | Why |
|---|---|---|
| Correctness | 6 | The core primitives are right (one lock per identity, atomic claims, exactly-one-target row invariant, chain-scoped status facts). The defects I found are at the *seams the voice split just created* — a two-valued feed vocabulary carrying a five-scoped system. |
| Stuck-resistance | 4 | The single worst dimension. **No approval wait anywhere has a timeout**, and four surfaces (voice wake, live calls, channels, delivery turns) cannot answer a card — the call leg in the *widest*-carding mode of all. The daemon has no turn budget and no abort. Restart handling, by contrast, is excellent. |
| Settings integrity | 6 | The `input ?? row ?? default` rule is clean and consistently applied; the mode-header fix closed the big one. But spawned sessions are born NULL, the fit guard is wired to one site, and the voice panel writes a row nothing reads. |
| Observability | 6 | The live channel + registry are genuinely well built. Undercut by: voice has no status at all, the durable rebuild seed is dead, and two global-status derivations coexist. |
| Continuity | 8 | The strongest area. Every runner that *has* a continuing identity is covered, the coverage is 1:1 verifiable, the terminal gate and depth cap are right, and the two uncovered runners are correct by construction. |
| Voice | 4 | The thread split is the right design and cleanly executed (one knob, `input.voice`). But it shipped without a status surface, without a card policy, without a daemon watchdog, with a settings UI that lies — and the call leg, which predates the arc, sits in `ask` mode with no card surface at all. |
| Tests | 8 | Dense, colocated, real-SQLite, and they pin the *reasons* (regression tests name their incident). The gap is invariant/census tests over cross-cutting rules. |
| Code health | 8 | Excellent: small files, one-home discipline, WHY-comments that carry decisions and dates. The one hazard is that stale comments are believed here. |

**What moves it up one point (→ 7):** send a mode on the call body (A5-11 — hours, not days), fix the
feed vocabulary (A5-01 + the real half of A5-04, one change), give the voice chain a status (A5-03),
and scope the node screen's project read (A5-07). Three of the four are the same class: *the display
and transport layers inferring identity the wire refuses to carry.*

**What moves it up three (→ 9):** the above, plus a **bounded approval policy as a first-class
concept** — every turn declares whether it has a card-capable surface, and card-less surfaces
fail-closed the way routed leaves already do (`drain-leaf-turn.ts:84`) — plus birth-stamping spawned
sessions' settings (which fixes A5-11 by construction), plus the fit guard on the delegated runners,
plus a continuity census test so §6's coverage cannot silently regress.

---

## 8. The VOICE SESSION — review and improvements

### End-to-end trace (verified)

```
wake word → VoiceSessionDriver.#runTurn (state=busy, no timeout)
  → createBrainClient → POST /root/turn { model: VOICE_TIER_MODEL, thinkingEffort: low, voice: true }
    → streamGlobalRootTurn: isVoiceTurn=true
        · resolveVoiceConversationTarget → getOrCreateContinuingSession(scope:'voice')   [same hidden cwd]
        · settings: input only, row NOT read (:152), NOT written (:338)
        · fitPinnedModelToSession clamp (:183)
        · activity.begin({ scopeKind:'global', origin:'voice' })   ← A5-01/A5-04 root
      → runGlobalRootTurnCore: lock `${userId}:voice` (:93), catch-up skipped, segment hidden/'voice'
        → provider turn, permissionMode default bypass-with-behavior-gate (:202)   ← A5-02 root
        → withBoundaryContinuity (:297) — swap/carry/nudge all apply
    → SSE frames → mapFrameToBrainEvent → daemon returns at session-completed (:88)
  → reply arrives via the `speak` MCP tool (mutatingApproved ⇒ never cards) → LineSpeaker → overlay
```

**What is right, and worth saying:** the design is a single knob (`input.voice`) threaded through one
core, which is exactly the house style; the lock split genuinely decouples speech from a fat global
brain; the fit clamp is the right generic insurance; the wall was closed in all three server homes
plus the socket; and the tier lives in one contracts home read by all three legs (G5).

### Where it breaks / gets stuck / speaks wrong

* **Stuck (calls):** A5-11 — the call leg resolves `'ask'`, the widest card set, on the one surface
  with a live human on the other end. Top voice risk.
* **Stuck (wake):** A5-02 (card park) + S2 (deaf daemon).
* **Invisible:** A5-03 — a *failed* voice turn produces no `problem` anywhere. (A *parked* one does
  surface, via the null-workspace approval → `attention.global`.)
* **Leaks the wrong way:** A5-01 — the *global* chat can render the voice thread. The wall was audited
  outbound (can voice read global?) but not inbound-from-the-client.
* **Double-speak / barge-in:** the design is sound — the daemon never speaks the reply text
  (`voice-session-driver.ts:255-257`), only the `speak` tool's words, and the drain/handoff state
  machine has explicit guards for the handoff-mid-drain case (`:200-215`, the "deaf-daemon bug"
  comment). I found no double-speak path. The residual is device-level (the recorded virtual-audio
  findings), not session-level.
* **Notes to global:** `send_message to:"global"` is note-only, rides the global single-writer key, and
  the marker is composed once at enqueue — I traced the guard rails and found them tight.
  `resolveTaskSender` for a voice turn resolves the **global** primary
  (`dispatch-message.ts:111-121`) and 400s with "Routing is only available during an active global-root
  turn" until global has spoken once — matching the doc.

### Judging the recorded open forks

1. **`direct_to_user` reaches only the global catch-up net** — **right to fix, and I'd rank it 3rd.**
   The failure is narrow (a voice-only user never hears a direct answer) but it is the exact promise
   voice makes. Cheapest correct shape: have the delivery runner, when the requester chain is the voice
   identity, deliver through the voice thread's own catch-up rather than adding a spoken-notification
   path.
2. **Voice-fired tasks parent on the global conversation** — **correct as shipped; do not re-plumb yet.**
   "Voice shows under Global" is coherent, the report lands where the user can act on it, and
   re-parenting would need a voice-side report surface that does not exist. Rank: **last**.
3. **Splitting the 503-line `routes/root/index.ts`** — **yes, but it is hygiene, not a next move.**
   Rank: 4th.
4. **Per-call sessions gaining the routing toolset** — **do NOT ship this next.** A5-11 shows the call
   leg is *already* in the most-carding mode in the system; adding a wider toolset to a surface that
   parks silently mid-call makes the existing hole bigger. The mode fix is a hard prerequisite, not a
   nicety.

### My ranked voice improvements

1. **Send an explicit non-carding mode on the call body** (`call-session-client.ts:33-37`) — the
   smallest possible fix for A5-11, and it can ship today.
2. **Card policy for card-less surfaces** — every turn declares whether it has a card-capable surface;
   surfaces that don't, fail closed the way routed leaves already do
   (`packages/orchestration/src/leaf/drain-leaf-turn.ts:15,84`). Closes A5-02, A5-11, S1, S3, S4 as a class.
3. **A turn budget + `AbortController` in the daemon**, plus a `busy`-state watchdog — closes S2 even
   when the server misbehaves for any other reason.
4. **Stamp `primarySessionId` on the voice `begin()`** — one line, closes A5-01 and the real half of A5-04.
5. **Give the voice chain a status** (fold branch + a Voice-chat status read) — closes A5-03.
6. **Make the voice composer's chips local-only** (or make voice read the row, only after 2) — G1/G2/C4.
7. Then: `direct_to_user` to the voice net · split the root routes · per-call routing toolset (last).

---

## Top 10 ranked

| # | ID | Sev | Finding | Where | Conf |
|---|---|---|---|---|---|
| 1 | A5-11 | P1 | A live CALL session runs in `ask` — the widest card set in the system — on a surface with no card; one carded `Read` and the assistant goes silent mid-call holding the target lock | `call-session-client.ts:33-37` · `session-turn.ts:95` · `record-spawned-session-segment.ts:60-72` · `tool-approval-policy.ts:113-122` | CONFIRMED |
| 2 | A5-02 | P1 | A voice turn parks on an approval card no spoken surface can answer, and the daemon then goes permanently deaf (no timeout anywhere) | `run-global-root-turn-core.ts:202` · `tool-approval-policy.ts:109` · `pending-approval-registry.ts:21-57` · `voice-session-driver.ts:112,250-276` | CONFIRMED |
| 3 | A5-01 | P1 | A running voice turn hijacks the global chat's continuing binding → voice transcript renders as the global thread (voice-first user, no race needed) | `global-root-turn.ts:321` · `activity-store.ts:61-77` · `use-continuing-conversation.ts:51-71` | CONFIRMED (repro) |
| 4 | A5-03 | P1 | The voice chain is excluded from the overview, so a **failed** voice turn produces `problem` nowhere in the app | `fold-session-chains.ts:68-69` · `use-session-statuses.ts:90-95` · `use-workspace-status.ts:126` | CONFIRMED |
| 4b | A5-04 | P2 | `runningPrimarySessionIdFor` returns the voice segment as the global primary (the other two first-match reads are the recorded stance / a stale comment) | `activity-store.ts:61-77` · `use-session-statuses.ts:49-56` | CONFIRMED (repro) |
| 5 | G1 | P2 | The Voice chat panel's composer chips PATCH a settings row the voice surface never reads | `VoiceChatPanel.vue:198` · `AppComposer.vue:97` · `global-root-turn.ts:152` | CONFIRMED |
| 6 | A5-07 | P2 | Node screen's project level reads the shared 50-cap unscoped overview and filters client-side | `use-project-nodes.ts:24,68-69` vs `use-sessions-library.ts:16-18` | CONFIRMED |
| 7 | A5-08/09 | P2 | The node display cannot be enlarged: 4-field `SceneNode`, stringly-typed ids, orbit lanes off-canvas from the 8th node | `constellation-scene.ts:19-25,224` · `NodesView.vue:88-92` | CONFIRMED |
| 8 | G0 | P2 | New **global** thread defaults to `bypass-with-behavior-gate` while a new workspace/DM thread defaults to `ask` — same "user never picked" condition, widest toolset, least carding, undocumented | `run-global-root-turn-core.ts:202` vs `chat-turn.ts:119` · `session-mode.ts:73-77` | CONFIRMED |
| 9 | S5/S6 | P2 | A global delivery burns a pool slot while blocked on the root lock; the 600 s budget bounds waiting, not the turn | `delegation-service.ts:194` · `run-delegation-claim-and-run-tick.ts:81` | CONFIRMED / PLAUSIBLE |
| 10 | A5-05/06/10 | P3 | Dead `/activity/running` rebuild seed · `continueEnabled:false` silently drops continuity + the writer lock · node arcs drop pre-swap segments | `routes/activity/index.ts:85-114` · `chat-turn.ts:142,292-299,475-478` · `message-scene-mapping.ts:60-65` | CONFIRMED |

## Score

**6 / 10** — see §7 for the rubric. Strong continuity and code health, excellent restart handling, a
genuinely good live channel; held down by an unbounded approval wait that **four** card-less surfaces
inherit (with live calls sitting in the widest-carding mode of all), and by a monitoring layer that
infers session identity the wire refuses to carry — which is precisely where the new voice thread
broke it.

**Corrections applied after review, stated for the lead's trust calibration:** my first draft claimed
(a) a parked voice turn reads "running" — false, `attention.global` wins the precedence; the true
unrescued case is a *failed* voice turn; (b) the 8th orbit node is drawn off-canvas — the arithmetic
was for the inscribed circle, not the ellipse; the real onset is `i ≈ 9` vertically on a 1600×900
stage, and the durable point is that the layouts are index-linear with no LOD; (c) `autoBuildout` is
inert — true, but *deliberately* so and documented, not a defect. All three are corrected in place.

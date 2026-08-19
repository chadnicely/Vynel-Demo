# Vynel session-system audit — AGENT 2

Worktree `E:\KLONE\Workspace\vynel\.claude\worktrees\session-audit` @ `06781328` (branch `feature/session-audit`).
Entry point per brief: the GLOBAL root + the VOICE thread beside it, then outward.
All paths are worktree-relative. **CODE WINS over docs** — where a module note and the code disagree I cite the code.

**Score: 6.5 / 10** (rubric in §7).

---

## 0. What I read (so the lead can weigh coverage)

Fully read: `streams/global-root-turn.ts`, `streams/chat-turn.ts`, `sessions/run-global-root-turn.ts`,
`sessions/resolve-global-root-conversation.ts`, `sessions/compose-session-mcp-servers.ts`,
`sessions/build-workspace-background-mcp.ts` (tail), `sessions/delegation-mode-header.ts`,
`runtime/run-global-root-turn-core.ts`, `root-turn-lock.ts`, `fit-pinned-model-to-session.ts`,
`compose-global-root-provider-message.ts`, `session-types.ts`, `run-turn-with-continuations.ts`,
`with-boundary-continuity.ts`, `apply-primary-turn-continuity.ts`, `bridge-primary-session.ts`,
`bridge-primary-session-after-turn.ts`, `run-seeded-swap-session.ts`, `continuation-turn.ts`,
`continuity/pending-checkpoints.ts`, `swapping-primaries.ts`, `delegation/run-report-delivery-tick.ts`,
`delegation/enqueue-checkpoint-continuation.ts`, `session-target-locks.ts`, `classify-turn-failure.ts`,
`orchestration/routing/route-request.ts`, `providers/claude/session/run-claude-chat-session.ts`,
`run-claude-distill-turn.ts`, `run-claude-session-summary.ts`, `approvals/tool-approval-policy.ts`,
`build-claude-can-use-tool-callback.ts`, `pending-approval-registry.ts`,
`approvals/requests/recover-stale-pending-approvals.ts`, `asks/mcp/ask-user-tool.ts`,
`chat/settings/*`, `chat/turn-consumption/handle-session-started.ts`, `handle-approval-requested.ts`,
`chat/records/record-spawned-session-segment.ts`, `overview/get-sessions-overview.ts`,
`overview/fold-session-chains.ts`, `apps/voice/src/brain/run-brain-turn.ts`,
`apps/voice/src/loop/voice-session-driver.ts`, `local-web` VoiceChatPanel / use-chat-turn /
activity-store / use-continuing-conversation / use-session-statuses / nodes composables /
NodesView / constellation-scene contract, `routes/root/index.ts` (voice doors + interrupt).
Grepped/spot-read: `session-turn.ts`, `run-delegation-claim-and-run-tick.ts`, `delegate-to-*.ts`,
`run-agent-run-job.ts`, `monitors/run-monitor-tick.ts`, `chat-search.ts`, `turn-session-header.ts`.

---

## 1. Bugs — all scopes (Global · Workspace · Spawned · Agent · Voice · channels)

### NEW

---
**A2-01 · P1 · VOICE + GLOBAL · Stop in the Voice chat panel interrupts the GLOBAL session (or nothing at all)**

*Where*
- `apps/local-web/src/components/chat/VoiceChatPanel.vue:76-80` — `useChatTurn({ scope: () => ({kind:'global'}), voice: true })`
- `apps/local-web/src/components/chat/VoiceChatPanel.vue:207` — `<AppComposer … @interrupt="turn.interrupt" />`
- `apps/local-web/src/composables/chat/use-chat-turn.ts:300-315`

```ts
    } else if (scope.kind === "global") {
      void vynel.root.interruptTurn().catch(() => undefined);
    }
```
- `apps/local-api/src/routes/root/index.ts:496-501`

```ts
      const primary = findPrimaryConversation(c.var.db, { userId: c.var.user.id })
      const sessionId = primary?.currentSdkSessionId ?? null
      if (sessionId === null) return c.json({ interrupted: false })
      await interruptChatSession(DEFAULT_PROVIDER_ID, sessionId)
```
- `packages/session/src/continuity/find-primary-conversation.ts:29-32` — no workspaceId ⇒ `findGlobalPrimarySessionForUser`, i.e. **scope 'global' only**. There is no voice variant of the interrupt route.

*Failure scenario.* Two harms, both reachable because the voice-session arc split the lock
(`${userId}` vs `${userId}:voice`) precisely so global and voice run **concurrently**:
1. Benign case — the user presses Stop on a running voice turn; the client aborts its own SSE stream, the
   server call interrupts the **global** SDK session (a different session), the voice turn runs on. Stop is a lie.
2. P1 case — a workspace-scale global turn is streaming in the Chat tab while the user stops a voice turn in the
   Voice chat panel. `interruptChatSession` aborts the **global** session mid-turn. The user's real work is killed
   by a control on another thread. This is a wall violation (a voice-surface action reaching across into global).
   Same route is also what the daemon-driven turn would need, and there is no door for it at all.

*Minimal fix.* Route the interrupt **by resolved session id**, not by `scope.kind` — `useChatTurn.interrupt`
already holds `activeSessionId` (the resolved segment) and passes a `displayedSessionId` fallback. Give
`POST /root/turn/interrupt` an optional `sessionId` body field, owner-check it against a scope-`'global'`-or-
`'voice'` chain, and fall back to the global primary only when the caller knows no session id. (An
`root.interruptVoiceTurn` resolving `findVoicePrimarySessionForUser` also works, but repeats the bug for the
next scope — per-call sessions.)

*Confidence:* **CONFIRMED** (traced at every hop).

---
**A2-02 · P1 · VOICE · The always-card floor parks a hands-free voice turn — deaf daemon + held voice lock for ~10 minutes**

*Where*
- `apps/local-api/src/streams/global-root-turn.ts:150-161` — a voice turn never reads the row and the daemon sends no
  `mode`, so `permissionMode` is `undefined`.
- `packages/session/src/runtime/run-global-root-turn-core.ts:202` — `permissionMode: input.permissionMode ?? 'bypass-with-behavior-gate'`
- `packages/providers/src/claude/base/build-claude-sdk-options.ts:92-98,177-178` — `'bypass-with-behavior-gate' → SDK 'default'`,
  and `allowedToolNames: []` (global-root, line 206 of the core) means **`options.allowedTools` is never set** ⇒ the
  native toolset (Bash/Write/Edit) is fully live.
- `packages/providers/src/claude/approvals/tool-approval-policy.ts:109-111`

```ts
  if (mode === 'bypass-with-behavior-gate') {
    return isAlwaysCardTool(toolName, sets) ? 'card' : 'allow'
  }
```
  with `TOOLS_ALWAYS_REQUIRING_APPROVAL = { Bash, Write, Edit, NotebookEdit }` (`tools-always-requiring-approval.ts:28-33`).
- `packages/providers/src/claude/approvals/build-claude-can-use-tool-callback.ts:70-88` — the card is an **unbounded**
  `await new Promise(...)`; the only resolvers are `respondToApprovalRequest` and `cancelAllForSession` (which only fires
  when the stream ends — circular).
- `apps/voice/src/loop/voice-session-driver.ts:253-280` — `#runTurn` sets `#state = 'busy'` and awaits `runBrainTurn`
  with **no timeout**; `pushAudio` (line 112) drops every mic frame while busy.
- `apps/voice/src/brain/run-brain-turn.ts:60-92` — `streamTurnEvents` has **no fetch deadline**.

*Failure scenario.* "Hey Vynel, what's in my downloads folder." The brain calls `Bash`. The card registers. The
daemon never renders cards (it maps only text/completed/failed — `run-brain-turn.ts:21-47`). The daemon sits `busy`,
deaf, silent — no spoken "I need your approval". The `${userId}:voice` root-turn lock is held, so the Voice-chat
panel's typed sends and every later wake queue behind it.
Recovery exists but is slow: the card **is** persisted (`handle-approval-requested.ts:63-78` records it with
`providerApprovalId = event.approvalRequestId`, the same uuid `canUseTool` registered, and a **nullable**
workspaceId), and the 60 s reaper (`apps/local-api/src/services/approvals-recovery-service.ts:15,28-37`) denies it
once `requestedAt + timeoutMs*2 < now` with `DEFAULT_TIMEOUT_MS = 5 min`
(`packages/approvals/src/requests/record-approval-request.ts:31`) ⇒ **~10 minutes of muteness**. If the desktop app
is open the `ApprovalNotifier` toast (`components/shell/ApprovalNotifier.vue`, user-wide poll) lets the user unstick
it — but the whole point of the surface is that nobody is looking.

*Minimal fix.* Voice is an unattended surface like the channel runner. Either (a) pass an explicit
`permissionMode: 'bypass'` for daemon-originated voice turns (the surface has no card renderer — the same reasoning
that already forbids voice reading a stored `'ask'`), or (b) keep the floor and give the voice leg a bounded
approval timeout + a spoken "I need your approval for X — check the app" line. (a) is one line and coherent with
the recorded voice-settings decision; (b) is the trustworthy one. Do not leave it as-is.

*Confidence:* **CONFIRMED** (traced end to end; no repro test needed — every hop is a literal).

---
**A2-03 · P1 · VOICE (also GLOBAL/WORKSPACE) · `ask_user` on a voice turn is unbounded and there is no periodic ask reaper — the thread parks until process restart**

*Where*
- `apps/local-api/src/streams/global-root-turn.ts:209-219` — the interactive descriptor, deliberately **no `timeoutMs`**:
  "ask_user here waits UNBOUNDED — this stream is the app's global chat, the user is present." The **voice** turn goes
  through this exact function.
- `packages/asks/src/mcp/ask-user-tool.ts:103-124` — the expiry timer is armed **only** `if (deps.timeoutMs !== undefined)`.
- `apps/local-api/src/sessions/run-global-root-turn.ts:56,272` — the channel runner correctly bounds it at
  `CHANNEL_ASK_TIMEOUT_MS = 10 min`.
- `apps/local-api/src/boot.ts:419-421` — asks get **boot recovery only** (`expireAskRequests(db, {}, …)`); grep for
  `setInterval` across `packages/asks` + `apps/local-api/src/services` returns **no ask reaper** (approvals have one;
  asks do not).

*Failure scenario.* A wake-word turn calls `ask_user`. The daemon can't answer a wizard. The promise never resolves;
the SDK agent stays parked; `runUnderRootTurnLock('${userId}:voice')` is held **forever**. Voice is dead until the API
process restarts. Same shape on the global/workspace interactive streams if the user closes the app mid-form (there
the AskNotifier gives a dismiss path, so it is P2 there; on voice there is none).

*Minimal fix.* Give the **voice leg** the channel runner's bounded descriptor (it is a hands-free surface, not "the
user is present"); separately, add a periodic `expireAskRequests` sweep with a generous age bound so a closed-app
interactive form can't wedge a lock for the process lifetime.

*Confidence:* **CONFIRMED**.

---
**A2-04 · P2 · VOICE / monitoring · The voice chain is dropped from the sessions overview, so no status indicator can ever show the voice thread as needs-input or problem**

*Where* `packages/session/src/overview/fold-session-chains.ts:66-69`

```ts
    const hasListedSegment = chain.some((segment) => segment.visibility === 'listed')
    if (tail.scope !== 'global' && !hasListedSegment) continue
```
A voice segment is born `{ visibility: 'hidden', title: 'Voice conversation', scope: 'voice' }`
(`run-global-root-turn-core.ts:279-282`), and swap segments inherit hidden. `tail.scope === 'voice' ≠ 'global'` ⇒ the
whole chain is skipped.

*Failure scenario.* Consequence chain: no overview entry ⇒ no `statusFacts` ⇒ `deriveSessionStatus` never runs for
the voice thread ⇒ `useSessionStatuses.statusFor()` returns null for it ⇒ the **Voice chat** menu row, the Sessions
library, and the node screen show nothing. Kafi's locked ONE-STATUS contract ("needs input = a pending ask_user
question · a pending approval card") is therefore **unimplementable for voice**: a voice turn parked on a card or a
form (A2-02/A2-03) lights **no indicator anywhere** except the generic ApprovalNotifier toast. This is the structural
reason A2-02 and A2-03 are *silent* failures rather than visible ones.

*Minimal fix — with a caveat I checked.* The tempting one-liner is to let `tail.scope === 'voice'` through the fold
and rely on `isSessionInScope` (`packages/contracts/src/chat/sessions-overview.ts:71-78`, which requires
`scope === 'spawned'` for the global library and a workspace id otherwise) to keep it out of the views. That is
**safe for the Sessions library** — `useSessionsLibrary` always passes a scope server-side
(`composables/sessions/use-sessions-library.ts:34-39`), so a voice entry can never reach it — but **not** for the
UNSCOPED overview, which several surfaces render directly: `components/activity/LiveSessionPane.vue:21`,
`components/tasks/TasksPanel.vue:120`, `components/sessions/SessionThreadView.vue:61`. Those would each need a
`scope !== 'voice'` filter. So: **recommended fix = a dedicated voice status read for the Voice-chat menu row**
(cheap, no leak surface); the fold change is the cleaner long-term shape but must ship with the three view-side
filters, not alone.

*Confidence:* **CONFIRMED** (read both the fold and the scope predicate).

---
**A2-05 · P2 · GLOBAL ↔ VOICE id conflation in the web · the Global chat can bind to the VOICE segment**

*Where*
- `apps/local-api/src/streams/global-root-turn.ts:321-325` — a voice turn announces `scopeKind: 'global'`,
  `origin: 'voice'`, and **no `primarySessionId`**.
- `apps/local-web/src/stores/activity-store.ts:61-77`

```ts
      if ((turn.primarySessionId ?? null) !== null) continue;
      if (scope.kind === "global" && turn.scopeKind === "global") return turn.sessionId;
```
- `apps/local-web/src/composables/chat/use-continuing-conversation.ts:66-71` —
  `continuingQuery.data.value?.currentSdkSessionId ?? runningId.value ?? lastRunningId.value`
- `apps/local-web/src/views/GlobalChatView.vue:114,118-123` — that value **is** the Global chat's `activeSessionId`.

*Failure scenario.* The `??` chain falls through whenever `continuingQuery.data` is `undefined` — which is **every
page load until the query resolves**, and permanently for a user whose global thread has never run a turn (a
voice-first user). If the daemon is mid-turn at that moment, `runningPrimarySessionIdFor({kind:'global'})` returns the
**voice** segment id and the Global chat renders / watches / patches the spoken thread. It self-corrects once the
continuing query lands (that branch wins), so the blast radius is a flash for most users and permanent for a
never-chatted global.

*Minimal fix.* Skip voice-origin turns in `runningPrimarySessionIdFor` (`turn.origin === 'voice'`), or — better and
one-way-correct — stamp `primarySessionId` on the global/voice `activityFeed.begin(...)` calls; the existing
`primarySessionId !== null → continue` guard then excludes both by construction.

*Confidence:* **CONFIRMED**.

---
**A2-06 · P2 · all scopes · `autoBuildout` is a dead setting: stored, copied forward, served, never read by any runner**

*Where* full-stack grep. It is written (`packages/chat/src/settings/persist-turn-session-settings.ts:30`,
`update-chat-session-settings.ts:34`), copied forward on swap (`handle-session-started.ts:152`,
`record-swap-segment-session.ts:107`), exposed on the settings route (`routes/sessions/index.ts:70-76`), and driven by
the composer (`AppComposer.vue:284,294`) — but `resolveTurnSessionSettings`
(`packages/chat/src/settings/resolve-turn-session-settings.ts:31-35`) returns only `{model, mode, thinkingEffort}`,
and **no** runner, prompt composer, or provider path reads `autoBuildout` anywhere in `packages/` outside the
settings/schema files.

*Failure scenario.* The user toggles "auto buildout" in the composer; the chip persists and re-renders; nothing about
the turn changes. A silent no-op control in the trust surface.

*Minimal fix.* Either wire it (it presumably belongs in the system-prompt append or the mention/spawn policy) or
remove it from the composer + contract. Leaving a persisted-but-unread user control is the worst of the three.

*Confidence:* **CONFIRMED**.

---
**A2-10 · P3 · delegation · An agent-run checkpoint follow-up drops `thinkingEffort` and the channel origin**

`packages/session/src/delegation/enqueue-checkpoint-continuation.ts:159-168` — the `agent-run` branch spreads only
`shared` (which carries `permissionMode` + `model`), while the session/workspace branches at 170-188 also spread
`...origin` and `...thinkingEffort`. A colleague continuing after a checkpoint silently loses its effort pin and its
Telegram origin (so its eventual push has no address). **CONFIRMED** by reading the three branches side by side.

---
**A2-11 · P2 · delivery · A recoverable notify-turn failure requeues after the inbound row already landed → the report can be delivered twice**

`packages/session/src/delegation/run-report-delivery-tick.ts:440-452` — on `outcome.status === 'failed'`,
`requeueIfRecoverable` retries when the message matches `RECOVERABLE_PATTERNS`
(`classify-turn-failure.ts:19-24`, which includes `timeout|api error|5\d{2}`). But the notify turn persists the
attributed **user row** (the report body) *before* the provider can fail — `delegateToWorkspaceRoot` /
`runGlobalRootTurn` both go through `consumeSessionEventStream`, which persists the inbound on `session-started`.
A retry therefore appends the same report to the requester's transcript a second time. The file header calls this
tolerated at-least-once ("a provider turn sits in the middle"), which is true for the *job*, not for the *transcript*.
**PLAUSIBLE** (I did not reproduce; the persist-before-fail ordering is read from
`handle-session-started.ts:107-193` + the runner's error path).

*Minimal fix.* Stamp the delivery job id (or `partialSessionId`) on the inbound row and make the retry skip when a
row with that key already exists in the requester's chain — the direct-reply path already uses exactly that idea
(`recordDirectReplyMessage` returns `persisted: false` when it would duplicate).

---
**A2-12 · P3 · VOICE · a voice continuation's anchor row carries a contradictory attribution**

`run-global-root-turn-core.ts:189-190,262-264` — the continuation persists `persistedBody` with
`messageAttribution = { userSourceKind: 'global-root' }` **and** `originChannel: 'voice'` (the input's value is
passed through unconditionally). The row reads as both a relayed anchor and a spoken user message. Cosmetic, but the
attribution homes are load-bearing for the delivered-card renderer. **CONFIRMED** by reading the call.

---
**A2-13 · P3 · VOICE · a mid-turn compaction swap on the voice thread titles the new segment "Voice conversation" instead of the swap title**

`handle-session-started.ts:125-129` — `newSessionOptions.title` wins over `SWAP_SEGMENT_TITLE`, and the voice branch
always supplies one. Harmless today (voice segments are hidden and the fold reads the chain), but it is the exact
class of drift that made `foldSessionChains` need a title-preference walk. **CONFIRMED.**

### Already recorded in `.claude/STATE.md` — verified real

| id | sev | claim | verdict |
|---|---|---|---|
| R-1 | **P1** | delegated small-model pick onto a fat target primary has no fit guard | **REAL.** `routes/routing/index.ts:411-423` lets the delegating model pick `model` per task; `enqueue-workspace-delegation.ts:112` stores it; `delegate-to-workspace-root.ts:163` passes it straight to the provider on the resumed head. `fitPinnedModelToSession` is wired **only** into `streamGlobalRootTurn` for voice (`global-root-turn.ts:182-195`). Rank: highest of the recorded residuals — it reproduces the exact 2026-08-19 incident on a different path. |
| R-2 | P2 | spawned sessions born with NULL composer settings ⇒ DM defaults to `ask` | **REAL.** `record-spawned-session-segment.ts:60-72` writes no settings columns; `session-turn.ts:95` `toPermissionMode(turnSettings.mode ?? DEFAULT_SESSION_MODE)` with `DEFAULT_SESSION_MODE = 'ask'` (`session-mode.ts:77`). |
| R-3 | P2 | `direct_to_user` reaches only the global catch-up net | **REAL.** `run-report-delivery-tick.ts:186-198` — `findPrimaryConversation(db, { userId })` = the global primary only. |
| R-4 | P2 | voice-fired tasks parent on the global conversation | **REAL** (design call, coherent with "voice shows under global"). |
| R-5 | P3 | `routes/root/index.ts` is 503 lines | **REAL** (`wc -l` = 503). |

---

## 2. Where a session can get STUCK while running

| # | Stuck point | How | Recovery | Evidence |
|---|---|---|---|---|
| S1 | **Voice turn parked on an approval card** | floor tool under `bypass-with-behavior-gate`, no card surface | 60 s reaper at `requestedAt + 10 min` denies it; daemon deaf meanwhile | A2-02 |
| S2 | **Any interactive turn parked on `ask_user`** (voice = fatal) | unbounded by design; **no periodic reaper**, boot only | app restart, or the user dismisses via AskNotifier (impossible on voice) | A2-03 |
| S3 | **Root-turn lock held through the boundary swap** | `withBoundaryContinuity` runs INSIDE `runUnderRootTurnLock` (`run-global-root-turn-core.ts:94,297`); worst case `DISTILL_TIMEOUT_MS = 240_000` (`run-claude-distill-turn.ts:38`) + `DEFAULT_PRIMING_TIMEOUT_MS = 120_000` (`run-seeded-swap-session.ts:45`) ⇒ **~6 min** of held `${userId}` | bounded; every queued channel/report-delivery/web turn simply waits (a report-delivery job burns its 600 s budget waiting — `DELEGATION_RUN_BUDGET_MS`, `run-delegation-claim-and-run-tick.ts:76`) | traced |
| S4 | **SDK stream that never ends mid-turn** | only *startup* is bounded (`SESSION_STARTUP_TIMEOUT_MS = 90_000`, `run-claude-chat-session.ts:41`); after the first message the interleave loop (`:275-330`) has **no wall clock** | none in-process; the client can Stop (workspace/global) — but **not voice** (A2-01) | traced |
| S5 | **`pending-checkpoints` / `swapping-primaries` are process-wide Maps** | `continuity/pending-checkpoints.ts:28-29`, `swapping-primaries.ts:10` | a restart silently drops a pending checkpoint (work stops at the checkpoint with no continuation) and a `turn-queued { reason:'context-patching' }` never fires again; documented as v1, correct for one process, wrong for the Phase-2 multi-pod target | read |
| S6 | **Delegation jobs orphaned in `claimed` by a crash** | claim is a CAS with no lease | **handled**: `delegation-service.ts:114-143` requeues orphaned report-deliveries and fails the rest at boot | read |
| S7 | **`routeRequest` timeout ≠ turn cancel** | `route-request.ts:17-20,138-152` — the turn keeps running detached; on a delivery the row is failed but the notify turn still lands | by design; the visible cost is a `failed` row for work that succeeded | read |
| S8 | **`SessionTargetLocks` leak** | if a holder never calls release the key wedges forever; every acquire site is in a `finally` (`chat-turn.ts:487-497` explicitly pins this) | disciplined but unenforced — one new call site without the `finally` wedges a workspace permanently | read |
| S9 | **Continuation loop** | capped at `MAX_CONSECUTIVE_CONTINUATIONS = 3` and gated on `session-completed` (`run-turn-with-continuations.ts:81-94`) | correct; no runaway | read |
| S10 | **Voice daemon loop** | `#state='busy'` for the whole brain turn with **no timeout** on `runBrainTurn`, and `streamTurnEvents` has no fetch deadline | none — the daemon cannot self-heal from any server-side park (A2-14) | `voice-session-driver.ts:253-280`, `run-brain-turn.ts:60-92` |

**A2-14 · P2 · VOICE** — the daemon has no client-side deadline anywhere on the turn path, so every server-side
park (S1–S4) becomes indefinite deafness with no spoken feedback. Minimal fix: a wall-clock race in `#runTurn`
(e.g. 3 min) that speaks "that's taking too long — check the app" and returns the driver to `active`, plus a
best-effort interrupt call once A2-01's route exists. **CONFIRMED.**

---

## 3. Settings binding — mode / model / effort / buildout

Sources: `resolveTurnSessionSettings` (input ?? row ?? undefined), each surface's own default,
`persistTurnSessionSettings` (input-only write-through), `wrapAppRequestWithMode` (one writer, three interactive
sites + the delegated composer).

| Path | mode | model | effort | buildout | source of truth | verified by |
|---|---|---|---|---|---|---|
| **Global web chat** (`streams/global-root-turn.ts:150-173`) | input ?? row ?? — ⇒ core default `bypass-with-behavior-gate` (`core:202`) | input ?? row | input ?? row | written only, **never read** | `chat_sessions` row + request | read; header stamped only when resolved (`:160-165`) |
| **VOICE turn** (same file, `input.voice`) | **input only** — daemon sends none ⇒ `bypass-with-behavior-gate`; a typed panel send carries the composer's mode | input only, then **fit-clamped** (`:182-195`) | input only (`VOICE_TIER_THINKING_EFFORT`) | n/a | the request, never the row; **never persisted** (`:338-340`) | read; `VOICE_TIER_*` is now ONE home (`@vynel/contracts/chat/voice-tier`, consumed by daemon `run-brain-turn.ts:51-55`, `VoiceChatPanel.vue:19-22`, call client) — the "three pins" are reconciled |
| **Workspace chat** (`streams/chat-turn.ts:101-116,178-180`) | input ?? row ?? **`'ask'`** | input ?? row | input ?? row | written only | row + request | read; write-through at `:266-271`; mode header at `:176-179` |
| **Spawned / agent DM** (`streams/session-turn.ts:94-107`) | input ?? row ?? **`'ask'`** | input ?? row | input ?? row | written only | row + request | read |
| **Spawn / birth of a child** (`record-spawned-session-segment.ts:60-72`) | **NULL** | NULL | NULL | NULL | — | **GAP R-2**: a child of an auto parent DMs at `'ask'` |
| **Channels + report/update/note delivery** (`sessions/run-global-root-turn.ts:277-327,391`) | never resolved ⇒ `bypass-with-behavior-gate` (deliberate, `:296-301`) | `input.model` (undefined in practice) | none | n/a | — | read |
| **Delegation enqueue** | `x-vynel-delegation-mode` → `delegation_jobs.permission_mode` (`delegation-mode-header.ts:42-51`) | routing-tool arg → `job.model` (`enqueue-workspace-delegation.ts:112`) | routing-tool arg → `job.thinkingEffort` | n/a | the delegating turn | read; the 2026-08-19 fix is real — all three interactive streams + the delegated composer (`build-workspace-background-mcp.ts:243`) stamp it |
| **`delegate-to-{workspace-root,spawned,agent}`** | `job.permissionMode ?? 'bypass-with-behavior-gate'` | `job.model` | `job.thinkingEffort` | n/a | the job row | read; **GAP R-1: no fit guard** |
| **Agent-run job** (`run-agent-run-job.ts:270-276`) | `job.permissionMode` | `job.model ?? agent.model` | `job.thinkingEffort` | n/a | job row then agent row | read |
| **Leaf session** (`delegate-to-leaf-session.ts:39-62`) | — | `input.model` only | — | n/a | caller | read |
| **Swap copy-forward** (`handle-session-started.ts:147-157`, `record-swap-segment-session.ts`) | inherited | inherited | inherited | inherited | predecessor | read |
| **Continuation (interactive)** | same closure values as the genuine turn (`chat-turn.ts:310-316`, `core:200-202`) | same | same | n/a | the turn | read — matches the "a run keeps what it was sent with" decision |
| **Checkpoint follow-up job** (`enqueue-checkpoint-continuation.ts:134-188`) | copied | copied | copied **except agent-run** (A2-10) | n/a | the parent job | read |

**Flagged gaps:** R-1 (no delegated fit guard) · R-2 (children born NULL) · A2-06 (`autoBuildout` unread) ·
A2-10 (agent-run follow-up drops effort/origin) · plus the design asymmetry that the *voice* surface deliberately
ignores the row for mode/model/effort **but the composer chips still PATCH that row** — so the Voice-chat chips are
authoritative for typed sends and inert for spoken ones. Worth a one-line note in the panel; today it silently
disagrees with itself.

---

## 4. Places we missed / improvements

1. **No lease on the delegation claim.** The CAS claim + boot reclaim is correct for one process, but a job claimed
   by a *live* process that hangs is invisible forever (no `claimedAt` watchdog). `delegation_jobs` already has
   `attemptCount`/`nextAttemptAt`; a `claimedAt + budget*2` sweep is ~20 lines and removes the last "stuck forever" class.
2. **No wall clock on a running turn.** `SESSION_STARTUP_TIMEOUT_MS` bounds startup only. Everything downstream
   (locks, the delegation pool slot, the daemon's `busy`) assumes turns terminate. One `AbortController` deadline
   (generous, e.g. 30 min, suspended while an approval is parked — `ApprovalWaitGate` already models exactly this)
   would make every lock analysis finite.
3. **`ask_user` has no reaper** while approvals do. Two adjacent human-wait queues with opposite restart policies.
4. **The interrupt surface is scope-shaped, not identity-shaped** (A2-01). `POST /root/turn/interrupt` taking no
   argument is the root cause; every future scope (voice today, per-call sessions tomorrow) repeats the bug.
5. **`activityFeed.begin` has no `'voice'` scopeKind** (`session-activity-feed.ts:31`). Voice rides `'global'` +
   `origin: 'voice'`, which forces every consumer to special-case the origin (VoiceChatPanel already does,
   `activity-store` and `use-session-statuses` do not — A2-05/A2-08). Widening the union is the honest fix and makes
   the two views' bindings mechanical.
5b. **A2-07 · P2 · the swap holds the root lock for up to ~6 minutes** — see S3 in §2 for the numbers. Bounded, so
   not a stuck-forever, but it is why a report-delivery job can burn its whole 600 s budget waiting on a global
   swap it has no visibility into. Suspending the delivery budget while the target is `isPrimarySwapping` (the
   `ApprovalWaitGate` pattern, already built) is the minimal fix.
6. **`fold-session-chains` is the single chokepoint** for "is this conversation visible to the app at all". Voice
   falls off it silently (A2-04). Any new hidden scope will too. A test asserting "every `primary_sessions` scope has
   a defined overview policy" would have caught it.
7. **Delivery double-write** (A2-11) — the direct-reply path already solved idempotency; the notify path did not.
8. **Testing gaps I could not find coverage for:** no test asserts that a voice turn cannot be interrupted by the
   global interrupt route; no test asserts the voice thread's absence/presence in the overview; no test pins that
   `autoBuildout` reaches a runner (because it doesn't).
9. **Observability:** a parked approval is logged nowhere at WARN level and has no metric; the only signal is the row.
   A single `logger.warn` at `canUseTool` park time (tool name, session, scope) would have made A2-02 obvious in the
   dev console during Kafi's smokes.

---

## 5. Monitoring binding + node display

**My interpretation:** I answer **both** readings, (a) the Nodes constellation view and (b) the wider live-monitoring
binding, because the brief's own wording ("more levels — fleet → project → sessions → spawned/agent runs → tasks")
is clearly about the Nodes screen while "one truth" is about the whole feed.

### (a) The Nodes constellation view

**Binding is genuinely one-truth today.** `resolveNodeStatus` (`composables/nodes/node-status.ts:25-41`) is a pure
rename of the real ladders; the fleet dots take `use-workspace-status`, the project dots take
`deriveSessionStatus` via `useSessionStatuses`. No invented states, and the file documents the ladder it replaced.
Both levels also gate on `hasAnswered` so a loading poll never paints a claim. This is good work.

**Enlarging it is NOT easy.** Concretely:
- **Levels are a boolean, not data.** `NodesView.vue:57-67` holds one `drilledProjectId` ref and everything branches
  on `isInsideProject`: `displayNodes` (`:68-71`), `sceneMessages` (`:76-95`, two *different* id vocabularies via
  `fleetMessages`/`projectMessages`), `onNodeClick` (`:139-146`), `coreLabel` (`:150-153`), `isProjectEmpty`
  (`:104-109`), and the `NodesFleetBar` props. A third level means touching six branches and inventing a third
  message mapping; a fourth means a combinatorial mess. There is no `level` model, no breadcrumb stack, no
  per-level `{ nodes, messages, onPick, coreLabel }` descriptor.
- **`SceneNode` carries four fields** — `{ id, name, initials, status }` (`utils/constellation-scene.ts:19-25`) — and
  the canvas tooltip renders only `labelFor(status)` (`:716`). "More info per node" (elapsed, model, context %,
  child count, task label) requires widening the type **and** the draw path in a 787-line single-frame-loop file
  that the header explicitly refuses to split.
- **The project level has no source for the deeper levels.** Spawned sessions/agent runs already exist as overview
  entries but tasks/agent-runs are *not* readable per-session in one call; `useProjectNodes` reads the shared,
  **capped, unscoped** overview and filters client-side (`use-project-nodes.ts:68-69`), so a workspace's sessions
  can be missing entirely once 50 newer conversations exist elsewhere (`DEFAULT_ENTRY_LIMIT = 50`,
  `get-sessions-overview.ts:44,109-111`) — the route *supports* `scope`, the composable doesn't pass it. That is a
  real bug for a workspace on a busy account, and it is also the blocker for "more nodes".
- **Perf:** `watch(displayNodes, next => scene?.setNodes(next))` fires on every overview invalidation with a fresh
  array identity; whether that resets the scene's position/orbiter buffers determines whether nodes visually jump on
  every turn-end. (I read the handle contract, not the buffer reconciliation — flagging as the thing to check first
  if scaling node count.)

**What to change (ranked):**
1. Pass `scope: { workspaceId }` to the overview from `useProjectNodes` (bug fix + unblocks depth).
2. Introduce a `NodeLevel` descriptor — `{ id, nodes, messages, coreLabel, onPick, parent }` — and make `NodesView`
   a stack of them. Every new level becomes one composable, not six edits.
3. Widen `SceneNode` with an optional `detail: { line1, line2 }` and render it in the tooltip only (no canvas math).
4. Give the feed a `voice` scopeKind so voice can be its own node under Global instead of being folded into it.

### (b) The wider live-monitoring binding

- **One truth, mostly.** `SessionActivityFeed` (server) → `LiveChannelHub` → `live-channel-store` → `activity-store`
  is a single path, and statuses derive from `deriveSessionStatus` in one contracts home. The 2026-08-17 "one rule"
  pass genuinely removed the invented `waiting`.
- **Where it drifts:**
  - **Voice is not modelled** (`scopeKind: 'global' | 'workspace'` only), which produces A2-05 (wrong session id) and
    **A2-08 · P3**: `use-session-statuses.ts:45-56` claims any `scopeKind==='global' && sessionId===null` turn for the
    Assistant entry, with the comment "Safe to claim: every OTHER global-scope turn on the feed is a spawned
    session's, and those always carry their session id from the start." That justification is **stale** — a voice
    turn is exactly such a turn, so the Assistant row flashes "running" for the whole engine-spawn window of every
    voice turn. **CONFIRMED**; low harm (running, not needs_input), but the comment now lies.
  - **Voice is unreachable by the ladder at all** (A2-04) — the biggest completeness hole.
  - **Double-derivation** survives in one place: `useProjectNodes` gives "The build" the **workspace** status while
    every session row gives itself its own; the file documents the known over-claim (an agent colleague's failure
    lighting the build dot, `use-project-nodes.ts:52-57`). Acceptable, documented.
  - **`hasGlobalServerTurn` / `globalServerTurnOrigin`** (`activity-store.ts:25-34`) are first-match reads over a map
    that can now hold a global **and** a voice turn simultaneously — the origin shown can be either. Same class as A2-05.
- **Sidebar / agent-run panes** ride the same registry and key by session id, so they are safe from the voice mix-up.

---

## 6. Session continuity everywhere

| Runner | pressure→swap | carry | checkpoint→auto-continue | whoami/duty book | notes |
|---|---|---|---|---|---|
| Global web | ✅ `withBoundaryContinuity` in `runOneGlobalTurn` (`core:297-310`) | ✅ | ✅ `runTurnWithContinuations` (`core:103-111`) | ✅ | |
| Global channels | ✅ same core | ✅ | ✅ | ✅ | |
| **VOICE** | ✅ same core, own primary | ✅ | ✅ | ✅ (`duty-global-root`) | swap segments inherit scope; the voice **no-write** rule and the settings copy-forward do not collide because voice rows are always NULL |
| Report/update/note delivery | ✅ swap runs | ✅ | ❌ **deliberately** `autoContinue: false` (`run-global-root-turn.ts:417`) + a stray checkpoint is dropped (`run-report-delivery-tick.ts:398-408`) | ✅ | correct |
| Workspace chat | ✅ (`chat-turn.ts:293-302`) | ✅ | ✅ `runContinuingTurn` | ✅ | only when `isContinueActive`; a plain by-id session has none, documented |
| Spawned DM | ✅ | ✅ | ✅ | ✅ | |
| delegate-to-workspace-root / spawned / agent | ✅ `withBoundaryContinuity` in each | ✅ | ✅ via `enqueueCheckpointContinuation` | ✅ | |
| delegate-to-leaf | ❌ none | ❌ | ❌ | — | correct: a leaf is one-shot |
| Agent-run job | ✅ | ✅ | ✅ (`run-agent-run-job.ts:225,327`) | ✅ | loses effort/origin on the follow-up (A2-10) |
| Monitor / schedule / task wakes | ✅ indirectly — they enqueue delegation jobs (`monitors/run-monitor-tick.ts` → `enqueueSessionDelegation`/`enqueueReportDelivery`) | ✅ | ✅ | ✅ | |

**Coverage is genuinely complete.** Where it can break:

1. **Multi-process / restart** — `pending-checkpoints` and `swapping-primaries` are module Maps. A restart between a
   checkpoint and its continuation silently abandons the work (the log line exists, the user sees a turn that stopped
   mid-task). Documented as a v1 call; it is the single biggest continuity fragility.
2. **Concurrent global + voice.** The lock split is correctly keyed, and the two identities have separate primaries,
   so no swap race exists. But `isPrimarySwapping` is read pre-lock in *both* streams
   (`global-root-turn.ts:345`) and keyed by primary id — that part is fine. The *unhandled* interaction is the
   monitoring one (§5) and A2-01.
3. **Lock scope vs the swap's 6-minute worst case** (S3) — continuity is correct but expensive under the lock.
4. **`<synthetic>` / zero usage** — closed: the translator drops usage from synthetic messages (2026-08-19 fix); I
   confirmed `prepareTurnContinuity` reads `segment.lastContextTokens/model` as the only measuring home
   (`apply-primary-turn-continuity.ts:124-131`), so the poisoning class is gone at its source.
5. **Model changes mid-chain** — `resolveContextWindow(segment.model)` uses the *last-ran* model, so switching from a
   1M model to a 200k one mid-chain makes the next turn's pressure read jump; that is correct *for the new turn* but
   there is no pre-turn fit guard outside voice (R-1). This is the same gap from a continuity angle.
6. **Carry losing content** — well defended: `MIN_CARRY_SUMMARY_LENGTH = 60` + the labelled-shape check
   (`run-claude-session-summary.ts:44-51`), and the distill runs on the turn's own model. Good.
7. **Client rendering** — the second `user-message-persisted` on one stream is the continuation signal; solid, but
   note it is *positional*, so any future runner that persists two user rows for other reasons would render as a
   continuation.

---

## 7. Score — **6.5 / 10**

| Axis | Score | Why |
|---|---|---|
| Correctness | 6 | The persistence/outbox/transaction discipline is genuinely excellent (co-commits, CAS claim, chain-scoped status facts). But the voice arc introduced a **cross-thread interrupt** (A2-01) and two id/scope conflations (A2-05, A2-08) within days of landing — the scope union was widened in the fences and forgotten in the feed. |
| Stuck-resistance | 5 | Two unbounded human-waits (A2-02, A2-03) on a surface with no human, no wall clock on a running turn, no claim lease, and the daemon has no client-side deadline. Boot recovery is strong; *running* recovery is thin. |
| Settings integrity | 7 | The 2026-08-19 mode fix is real and complete across all four writers. Two recorded gaps stand (R-1, R-2) plus one dead setting (A2-06). |
| Observability | 6 | One activity truth, one status ladder, real replay — but voice is invisible to the ladder (A2-04) and a parked approval logs nothing. |
| Continuity | 8 | The best part of the system: every runner covered, the boundary op is one home, the carry has a fidelity floor, the continuation loop is capped and terminal-gated. Loses points only for the process-wide registers. |
| Voice | 5 | The thread split is architecturally right and the wall was closed carefully; the *operational* half (stop, approvals, asks, status, daemon timeouts) is not there yet. |
| Tests | 7 | Colocated, real SQLite, and the regression tests pin the right invariants (the swap-title fix, the chain-scoped facts). Gaps are exactly where the new bugs are. |
| Code health | 8 | Comments explain WHY at a level I rarely see; one-home discipline is real. `routes/root/index.ts` at 503 lines and `run-delegation-claim-and-run-tick.ts` at ~900 are the exceptions. |

**+1 point** = fix A2-01 (identity-shaped interrupt), A2-02/A2-03 (bound the voice surface's human-waits the way the
channel runner already does), and A2-04 (give the voice chain a status entry). That is roughly a day and turns voice
from "works when nothing goes wrong" into a trustworthy surface.

**+3 points** = the above, plus: a wall clock on every running turn (suspended while an approval is parked — the
`ApprovalWaitGate` already models it), a `claimedAt` lease on delegation jobs, a `'voice'` `scopeKind` on the activity
feed with `primarySessionId` stamped on every `begin`, R-1's fit guard moved into the `delegate-to-*` runners, and
either wiring or deleting `autoBuildout`. At that point every "stuck forever" class is closed and every indicator
covers every scope.

---

## 8. The VOICE SESSION — review

**End-to-end trace (verified).**
`VoiceSessionDriver.#handleSegment` → `detectWakeWord` → `#runTurn` (state `busy`) → `createBrainClient` POSTs
`/root/turn` with `{ voice: true, model: VOICE_TIER_MODEL, thinkingEffort: 'low' }`
(`apps/voice/src/brain/run-brain-turn.ts:97-107`) → `streamGlobalRootTurn` branches on `input.voice`
(`:129-133`) → `resolveVoiceConversationTarget` (`resolve-global-root-conversation.ts:51-64`, scope 'voice',
**same hidden cwd** as global) → settings no-read (`:150-155`) → fit clamp (`:182-195`) → core keys off
`input.voice`: lock `${userId}:voice` (`core:93`), `newSessionOptions` scope 'voice' (`core:279-282`), catch-up
skipped (`compose-global-root-provider-message.ts:40-43`), voice marker appended per message (`:48-50`) →
the model replies by calling `speak` (an x-mcp route tool, `routes/voice/index.ts:66-103`) → `speakThroughDaemon`
→ `LineSpeaker` (sentence pipelining + drain wait + cut) → the overlay via
`live/voice-daemon-relay.ts` (one SSE link per surface, fanned on `voice:<surface>`).

**What is right.** The knob is genuinely ONE (`input.voice`), the lock split is correct, the catch-up skip is the
right call (the collector marks exactly-once), the wall was closed in all three fences (`chat-search.ts:73-76`,
`routes/sessions/index.ts:249-251`, `turn-session-header.ts:51-60`), and the model/effort pins now live in one
contracts home (`@vynel/contracts/chat/voice-tier`) — I checked **all four** consumer legs: the daemon wake line
(`apps/voice/src/brain/run-brain-turn.ts:51-55,103-104`), the **call client**
(`apps/voice/src/call/call-session-client.ts:2,35-36`, re-exported through the brain client), the **web overlay
leg** (`apps/local-web/src/composables/voice/use-voice-session.ts:5-6,46-47`), and the Voice-chat composer
defaults (`VoiceChatPanel.vue:19-22,198-201`). No hardcoded `claude-sonnet-5` survives outside
`packages/contracts/src/chat/voice-tier.ts` — the brief's "three pins — one home?" question answers **yes, one
home, verified**. Continuity is fully applied to the voice thread (§6).

**Where it breaks / can get stuck.**
- **Stop reaches the wrong thread** — A2-01, the worst of the set.
- **Parks with no voice and no light** — A2-02 (approval, ~10 min), A2-03 (ask, until restart), A2-04 (no indicator),
  A2-14 (no daemon deadline). Together these are the arc's real hole: the *conversation* was split correctly and the
  *operational envelope* was not.
- **Drop / double-speak.** Reply text is spoken only via the `speak` tool, and `LineSpeaker` owns ordering + the
  drain wait, so double-speak is well defended. One real drop path: `streamTurnEvents` returns at
  `session-completed` (`run-brain-turn.ts:88`) — correct and deliberate — but if the model calls `speak` *after*
  `session-completed` (it cannot on the main thread) or the daemon is unreachable, the reply exists only as text in
  the voice transcript with no spoken fallback and no user-visible error. Acceptable; worth a log.
- **Barge-in / self-echo.** v1 has no user barge-in (`voice-session-driver.ts:15-19`); the echo defense is
  `busy` + `notifyPlaybackDrained`. The 2026-08-19 device findings (default capture endpoint) are recorded and
  guarded. Nothing new from me here.
- **Wall leaks.** I found **none** on the server (search/sessions/`isTurnFromGlobalRoot` all know 'voice'; the two
  UI doors are `userScoped` with no `x-mcp`; `isSessionInScope` cannot surface a voice row). The leak I found is the
  opposite direction and client-side: A2-05 (global chat binding to a voice segment) and A2-01 (voice Stop reaching
  global).
- **Mode/model/effort binding.** Correct and single-homed (§3), with one self-contradiction worth naming: the
  Voice-chat composer chips **PATCH the voice row** but the row is never read by a turn, so the chips govern typed
  sends only and are inert for spoken ones.
- **Notes to global.** The rail is correct: both-null `note` row → `isGlobalNoteDelivery`
  (`run-delegation-claim-and-run-tick.ts:203-215`) → shared `GLOBAL_ROOT_DELIVERY_TARGET_KEY` (single-writer) →
  `runReportDeliveryJob` → global requester → `runGlobalRootReportTurn` with `autoContinue: false`. Notes are
  excluded from the direct-reply shortcut (`run-report-delivery-tick.ts:186`). I could not find a loss path.

**Judging the recorded open forks.**

| Fork | Verdict |
|---|---|
| `direct_to_user` reaches only the global catch-up net | **Right to name, wrong to defer past the operational fixes.** But the cheapest correct move is not "voice-thread absorption" — it is the *spoken notification* option: a `direct_to_user` row already has the daemon's `speak` route available. Rank **3rd**. |
| Voice-fired TASKS parent on the global conversation | **Right call, leave it.** It is coherent with "voice shows under global", it keeps the work ledger in one place, and re-plumbing it would fork the catch-up net. Rank **last**. |
| Split the voice doors out of `routes/root/index.ts` (503 lines) | **Right but cosmetic.** It buys legibility, not correctness. Rank **5th** — do it while fixing A2-01, since the interrupt route lives in the same file. |
| Per-call sessions gain the routing toolset | **Right, but not next.** Calls are a separate arc and adding tools to an unattended surface without first fixing the approval/ask envelope (A2-02/A2-03) would multiply the park class onto per-call sessions. Do it **after** the envelope. Rank **4th**. |

**My ranked improvements for voice:** 1) A2-01 identity-shaped interrupt · 2) A2-02 + A2-03 + A2-14 (bound every
human-wait and every client-side wait on the hands-free surface; speak an honest line when a turn is blocked) ·
3) A2-04 give the voice chain a status entry so needs-input is visible · 4) `direct_to_user` spoken delivery ·
5) a `'voice'` `scopeKind` on the activity feed (fixes A2-05 + A2-08 and unblocks a voice node) · 6) split the doors.

---

## Top 10 ranked

| # | id | sev | one line |
|---|---|---|---|
| 1 | A2-01 | P1 | Voice-panel Stop interrupts the GLOBAL session — can abort a concurrently-running global turn |
| 2 | A2-02 | P1 | The always-card floor parks a hands-free voice turn: ~10 min deaf daemon + held voice lock |
| 3 | A2-03 | P1 | `ask_user` is unbounded on the voice leg and has no periodic reaper — parks until restart |
| 4 | R-1 | P1 | (recorded) delegated small-model pick onto a fat primary has no fit guard — reproduces the 2026-08-19 crash |
| 5 | A2-04 | P2 | The voice chain is dropped from the overview, so no indicator can show voice needs-input/problem |
| 6 | A2-05 | P2 | `runningPrimarySessionIdFor('global')` can return a VOICE segment id — Global chat binds to the spoken thread |
| 7 | A2-14 | P2 | The voice daemon has no client-side deadline anywhere — every server park is indefinite silence |
| 8 | A2-06 | P2 | `autoBuildout` is persisted, copied forward and served but never read by any runner |
| 9 | A2-11 | P2 | A recoverable notify-turn failure can deliver the same report twice into the requester's transcript |
| 10 | A2-09 | P2 | Nodes: two hardcoded levels + a 4-field `SceneNode` + a capped, client-filtered overview — not enlargeable, and a busy account loses project nodes |

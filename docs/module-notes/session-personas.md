# Persona sessions + communication lifecycle + live activity view — module notes

**Status:** PLANNED 2026-08-04 (plan approved by Chad; full plan lives in the session plan file,
condensed here per build discipline). This arc structures the three flows that never reached a
final point: agents-as-people, the ack/report lifecycle, and the live activity view.

## Chad's instruction (verbatim intent)

Everything is a session; sessions/agents are PEOPLE working in a group — chatting with each other
and with the user, each carrying identity/persona. Delegation flows down
(global → workspace → session → agent), acknowledgments and reports flow back up in the persona's
own words, and the user can SEE the group working live: chat bubbles show live states, clicking
one opens what that session is doing right now, the user can send a message directly into it, and
a Claude-desktop-style background view lists everything running. Liveness must be durable (DB) —
a refresh or restart rebuilds the picture, and a session holding multiple tasks is tracked
per-task. Every message is attributed: from the user, from a session, or from a channel.

## Forks — settled WITH Chad (2026-08-04)

1. **Colleague model.** Each configured agent gets ONE continuing session per
   (user, workspace|global) — get-or-create; every `@mention` resumes it; persona + memory
   accumulate. In-turn SDK subagents (Explore etc.) stay ephemeral nested activity. This lands the
   deliberately-deferred `agent` scope (`primary_sessions.scopeRef` = agent slug) and RETIRES the
   agent-run harvest exception — colleagues speak through `send_message` like everyone else.
2. **Model-spoken acks.** The child acknowledges in its own words via `send_message` before
   working ("Received — will report when done"), may send interim updates, and cascades
   parent-to-parent at its discretion. New `update` kind: runs the notify machinery but NEVER
   marks the job reported (final `report` only). Steers rewritten acknowledge-first.
3. **Live view.** Per-task persona cards at the thread's live edge (keyed
   `partialSessionId ?? jobId` — two tasks on one session = two cards) → click opens a live
   session pane (full-fidelity fold + composer, sends queue mid-turn) → app-wide Background
   panel. Durable substrate = new `session_turns` envelope table written through the
   `SessionActivityFeed` (one seam covers every producer); steps/queued tasks DERIVE from
   `chat_tool_calls` / `delegation_jobs` — no step storage, no per-row outbox.

## Locked rules that hold throughout

- Reports travel ONLY via `send_message` — the leaf exception is being *removed*, not extended.
- Requester identity = server-stamped headers, never model input (`report-caller-header.ts` gains
  an `agent-session` variant; per-job composition already correct for shared colleagues).
- Watch chips one level down per surface; tree topology, upward chains terminate at global.
- Persona NAME is the only API-side persona field; icons/images stay local-only customize.

## Known gaps this arc closes (found in research)

- `chat_messages.threadId` never landed (only `delegation_jobs` got it) — each delivery hop mints
  a fresh `partialSessionId`, so UI settle-matching (card ↔ ack/report row) NEEDS the additive
  column; the session-messaging design doc already prescribed it.
- Leaf agent transcripts are not persisted; leaves are invisible in the session library; agent
  approvals fail-closed denied → colleagues get real chat rows (listed), continuity, and
  record-and-park approvals.
- `stores/live-sessions-store.ts` is dead demo code — watch chips NEVER show live state.
- The watch fold (`applyTraceStreamEvent`, 10 kinds) silently drops thinking/lifecycle/errors/
  usage that the chat fold (18 kinds) renders — converges onto one reducer + a pure selector.
- Watch v1 is one-attach-one-turn (no re-attach); `SessionThreadView` freezes on mid-turn
  compaction swap (accepted then, fixed now via live chain-head resolution).
- Orphaned claimed jobs die silently on restart — with ack-first, silence breaks the spoken
  contract; startup now enqueues honest failure deliveries (work rows only, anti-cascade kept).

## Deliberate calls (recorded)

- **Claim FIFO untouched** — a kind-priority reorder of the shared claim SQL risks starving acks
  and widens blast radius; update coalescing (one pending per user+target+threadId) + the
  `GLOBAL_ROOT_DELIVERY_TARGET_KEY` serialization bound update traffic instead.
- **Failed update = terminal drop** (logged, visible on the row) — an update is ephemeral status;
  a report is the only copy of a result and keeps its delivery guarantees.
- Colleague boundary-pressure swap deferred for parity with spawned sessions (stated in header).
- Leaf machinery stays in place after A4 (dead on the mention path); removal is a later cleanup.
- `MAX_CONCURRENT_DELEGATIONS` stays 3; monitor ack compliance before tuning.

## A5 checklist (from the A2 adversarial review — every `jobKind` reader to touch)

- `run-delegation-claim-and-run-tick.ts:171-177` — add the update-delivery branch AND widen the
  targetKey ternary (a running global update must HOLD `GLOBAL_ROOT_DELIVERY_TARGET_KEY`; the A2
  claim-side gate is one-sided until this lands).
- `settle-failed-delegation-attempt.ts:69` — anti-cascade guard becomes `isDeliveryJobKind` (a
  terminally failed update must DROP, never push a give-up report).
- `resolve-thread-chain.ts:24,56` + `attach-delegation-task-labels.ts:28` +
  `attach-delegation-tool-outcomes.ts:75` — update rows must not render as tasks / label chips.
- Use the A2 one-home helpers (`DELIVERY_JOB_KINDS`, `isDeliveryJobKind`, `isWorkJobKind`) —
  never re-spell kind literals.
- The tick has NO update-delivery run branch yet (targetKey + claim gate landed early with A4) —
  a claimed update row would fall into the task path. The run branch MUST land WITH the producer.

## A9 retirement notes (2026-08-04)

- The three superseded tools are REMOVED (routes + schemas + parity rosters); their dispatch
  cores live on in `dispatch-message.ts`. Their route tests were PORTED onto
  `POST /routing/message` (same behavioral coverage, mapped bodies).
- `send_message` gained the optional ambient `workspaceId` field (Slice ④b parity): the old
  delegate-session tool's generator-injected creator workspace would otherwise have been LOST —
  a workspace-only user's session sends would 400 without an active global root. Session sends
  only; workspace-target sends still parent on the global root (the standing unified-tool shape —
  a follow-up could resolve the creator from the caller header instead).

## B-slice notes (from the A4 review)

- GLOBAL colleagues (workspaceId null) are invisible in the Sessions panel — `SessionsView.vue`
  global scope filters `scope === 'spawned'`; widen to agents when the panel work lands.
- Liveness-scope inconsistency: a mention run announces workspace-scoped when grounded; a
  task-branch run on the SAME colleague announces global (spawned precedent) — unify when the
  live view builds on the feed.
- B6 direct-send into a colleague must acquire the same `SessionTargetLocks` key (the key is
  already the primary id; `POST /sessions/:id/turn` 404s agent scope until then).

## B6 notes (shipped shape + accepted residuals)

- Chain-following is an explicit `followChain` prop on `SessionThreadView`: head opens + the
  monitor pane follow the chain live (`resolve-chain-head.ts` over the overview, quiet
  "conversation continued" note); a deliberately-opened EARLIER part passes false and stays put.
- The direct-send rule's wording lives in ONE home (`session-open-affordance.ts`) shared by
  SessionsView and `LiveSessionPane`. Colleague direct-send stays deferred (the MCP-set parity
  item above) — the pane points at @mention instead.
- Monitor-store stacking rule: `openTrace`/`openAgentDirect` PUSH while the panel is open (the
  scrim guarantees the click came from inside it) — Back walks the whole pipeline; panel-closed
  behavior unchanged.
- The pane refetches its own detail when the watched overlay settles: the registry's settle
  snapshot only warms the provider-owning subscription (the monitor's, inside the panel); the
  feed's turn-end invalidation covers the same gap app-wide.
- ACCEPTED residuals: the panel header's live dot keys on the node's OPENED id — after a
  mid-watch chain swap the body follows the head while the dot may idle (rare, self-heals on
  reopen; post-swap the monitor and pane briefly hold two streams — bounded at 2, dying on
  close). SessionsView's `is-active` row highlight likewise stays on the opened id after a
  swap. No panel-level composer mount test (AppComposer's five eager roster queries make the
  harness heavy; the pane unit test pins the affordance props and Chad's smoke covers the send).
  A superseded view-only part holds an idle registry watch (one code path; entries die at
  refCount 0 — released on unmount, so boundedness is one per mounted thread, not an LRU).
- B5 review fixes (applied with B6): workspace threads scope their persona cards to THEIR
  delegations (`onlyWorkspaceId` — the old banner's `inFlightDelegationsHere` rule; the global
  thread keeps the full creator roster). The acked detector excludes `'global-root'`-attributed
  rows — that stamp is the PARENT's routed task, not the child speaking (in the target
  workspace's thread it shares the chain key and flipped the badge at turn start). The
  `.narration-*` transition classes hoisted to `styles/app.css` (scoped copies matched nothing
  outside LiveSessionCard — the crossfade silently never ran). ProcessingBanner reduced to the
  origin-note strip (dead chip machinery deleted; keyless-job visibility intent moved to the
  cards — a keyless card hides Watch/Stop, which would no-op without a trace key).

## Move map

Backend: A1 agent scope/scopeRef → A2 update-delivery kind + coalescing → A3
`delegateToAgentSession` → A4 mentions-resume-colleague + retire harvest (RISKIEST) → A5 `update`
kind + steers + `chat_messages.threadId` → A6 restart parity → A7 `session_turns` + feed recorder
→ A8 producer enrichment + running-turns read → A9 retire the three superseded tools (LAST) →
A10 `deriveMessageOrigin`.
Frontend: B1 chip liveness (delete dead store) → B2 one fold → B3 live-turn registry → B4
narration steps ring → B5 `PersonaLiveCard` → B6 live session pane + direct send → B7 Background
panel → B8 origin rendering + composer destination. B1–B4 independent now; B5 needs A5 for
acked/settle; B7 full fidelity needs A7/A8.

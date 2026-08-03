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

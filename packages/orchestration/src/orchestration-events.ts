// Outbox event types for the `orchestration` domain — agent-run lifecycle
// signals for the future `monitor` (its activity log / session-agent tree).
//
// Phase-1 GRANULARITY = per-orchestrated-turn: one started/completed pair
// per chat turn that had agents available for delegation (correlated by
// `runId`). This is the deliberate "minimal" cut for this unit — the
// `monitor` piece deepens it to PER-SUBAGENT-invocation via the SDK's
// `SubagentStart`/`SubagentStop` hooks (see `docs/agent-base/monitor.md`).
// Until then these give the monitor a coarse "orchestration happened"
// signal without touching the safety-critical session event stream.
//
// Published from `apps/api` session-build (`streamChatTurn`) via the
// `_shared` outbox — no cross-domain repo writes. Phase-1 consumers: NONE
// (the monitor is a later piece); published from day one so it can
// subscribe without a producer-side change.

export const AGENT_RUN_STARTED = 'agent.run-started' as const
export const AGENT_RUN_COMPLETED = 'agent.run-completed' as const

// `session.delegated` — the parent→child SESSION-TREE EDGE, emitted when a root
// (or manager) delegates a task to a leaf agent session BY REFERENCE (Slice 3a,
// the addressable-orchestration rails). Unlike `agent.run-*` (a coarse per-turn
// "agents were available" signal), this records the actual hierarchy edge: WHO
// delegated to WHOM. By-reference delegation is NOT an SDK `SubagentStart` event
// (that hook fires only for INLINE Mode-A subagents), so without this event the
// monitor (Slice 5a) would have no signal for the by-reference tree. The monitor's
// `activity_log` consumes it to reconstruct the global→workspace→agent tree
// (`.claude/docs/agent-base/root-session-architecture.md §7`).
//
// PAYLOAD IS LOCKED (the overnight-run contract): emitted by 3a, consumed by 5a —
// changing it after 3a merges is cross-slice rework. Keep all five fields.
export const SESSION_DELEGATED = 'session.delegated' as const

export type SessionDelegatedPayload = {
  /** The delegating (parent) session — a root or a manager session id. */
  parentSessionId: string
  /** The delegated-to (child) LEAF session — its SDK session id (D15: also its
   *  `chat_sessions.id`). */
  childSessionId: string
  /** The delegated agent's slug (which "hand" the child runs) — the edge's role. */
  role: string
  userId: string
  /** ISO-8601 emission instant. */
  ts: string
}

export type AgentRunStartedPayload = {
  /** Correlation id pairing this `started` with its `completed`. */
  runId: string
  userId: string
  /** null = the GLOBAL root session (user-scope agents, no workspace). */
  workspaceId: string | null
  /** Slugs of the agents made available to the root for this turn. */
  agentSlugs: string[]
  startedAt: string
}

export type AgentRunCompletedPayload = {
  runId: string
  userId: string
  workspaceId: string | null
  completedAt: string
}

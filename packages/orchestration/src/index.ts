// Public surface of the `@vynel/orchestration` package — the delegation engine.
// Consumers import from `@vynel/orchestration`.
//
// Orchestration is the VERB over the `agents` noun: resolve `@mention`s,
// compose enabled agents into the chat session, and emit agent-run
// lifecycle events. SDK-boundary enforcement (the canUseTool/PreToolUse
// approval gate) lives in `packages/providers` — NOT here — per the
// locked seam (`docs/agent-base/orchestration.md` "Key choices").

export type {
  StructuralLogger,
  AgentMention,
  DelegationPermissionMode,
} from './orchestration-types.js'

export {
  composeSessionAgents,
  type ComposeSessionAgentsInput,
} from './agents/compose-session-agents.js'
export {
  resolveMentions,
  parseMentionSlugs,
  type ResolveMentionsInput,
} from './agents/resolve-mentions.js'

export {
  AGENT_RUN_STARTED,
  AGENT_RUN_COMPLETED,
  SESSION_DELEGATED,
  type AgentRunStartedPayload,
  type AgentRunCompletedPayload,
  type SessionDelegatedPayload,
} from './orchestration-events.js'
export { recordAgentRunStarted, recordAgentRunCompleted } from './records/record-agent-run.js'

// Addressable-session orchestration — the by-reference delegation rails (Slice
// 3a, gold §5). The root runs a leaf agent in ITS OWN session and absorbs only
// the clean result. The internal helpers (`drainLeafTurn`, `mapAgentToLeafInput`)
// stay out of the barrel — they are implementation detail of `createLeafSession`.
export {
  createLeafSession,
  type CreateLeafSessionInput,
  type CreateLeafSessionResult,
  type SessionReference,
} from './leaf/create-leaf-session.js'
export { pushToSession, type PushToSessionInput } from './leaf/push-to-session.js'
export {
  runRootDelegationTurn,
  type RunRootDelegationTurnInput,
  type RunRootDelegationTurnResult,
} from './leaf/run-root-delegation-turn.js'
export { recordDelegation, type RecordDelegationInput } from './records/record-delegation.js'
export {
  enqueueWorkspaceDelegation,
  type EnqueueWorkspaceDelegationInput,
  type DelegationOrigin,
} from './routing/enqueue-workspace-delegation.js'

// The global-root catch-up (Ch3.5 root-awareness fix): the terminal delegations the root
// hasn't been told about, as a context block to prepend to its next turn.
export {
  collectDelegationReportsForRoot,
  type DelegationReportsForRoot,
} from './queries/collect-delegation-reports-for-root.js'
// The write-back half of that catch-up: mark the surfaced terminal delegations so the
// next collect skips them. The session-tier global-root runner calls it AFTER the turn
// absorbs the reports — paired with the read above.
export { markDelegationsSurfacedToRoot } from './repositories/index.js'
// The trace ANCHOR read — the session-tier trace view (apps' resolve-delegation-trace)
// starts from the job row keyed by partialSessionId, then composes chat reads itself.
// Only the anchor is exported; the composed VIEW stays out of this leaf (see below).
export { findDelegationJobByPartialSessionId } from './repositories/index.js'
export type { DelegationJobStatus } from './schema/delegation-jobs.js'
// The queue's CONSUMER half (brain-tree Ch1) — the app-tier delegation service
// claims one pending job per tick, runs it, and records the terminal state; at
// startup it fails the jobs a crash left stuck `claimed`. Re-exported (the
// findDelegationJobByPartialSessionId precedent) — repos stay in this leaf.
export {
  claimNextPendingDelegationJob,
  completeDelegationJob,
  failDelegationJob,
  failOrphanedClaimedDelegations,
  findDelegationJobById,
  type DelegationJob,
} from './repositories/index.js'

// The user's in-flight delegations (Ch3.5) — drives the /global "Vynel is processing…" indicator.
export {
  listInFlightDelegations,
  type InFlightDelegation,
} from './queries/list-in-flight-delegations.js'

// LLM-native routing (Slice 4): the request-down / report-up coordinator the
// global-root routing MCP tool invokes. Pure — the composing tier injects the
// by-reference `delegateToLeafSession` as the `delegate` dep.
export {
  routeRequest,
  DEFAULT_ROUTE_TIMEOUT_MS,
  type RouteRequestInput,
  type RouteRequestResult,
  type RouteRequestDeps,
  type DelegateForRouting,
} from './routing/route-request.js'

// The trace-read — the condensed, attributed chain of one delegation request
// keyed by its `partialSessionId` — is NOT exported here. It reads `@vynel/chat`
// messages as well as orchestration jobs, so it is a cross-domain composed VIEW:
// it lands at the session/monitor tier (with the Ch3 trace panel backend), not
// in this delegation-engine leaf. Orchestration's only cross-dep stays `agents`.

// The third by-reference op — "look up" (gold §5) — is the EXISTING chat op
// `getChatSessionDetail` (`@vynel/chat`). No orchestration→chat wrapper is added:
// orchestration's designed dependency is the `agents` domain, not `chat`; a
// caller reads a leaf's recorded detail via chat directly (the session-tier
// composition imports both).

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
  type ResolveMentionsInput,
  type PersonaMention,
  type WorkspaceRefMatch,
  type ResolvedComposerMentions,
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
export { recordDelegation, type RecordDelegationInput } from './records/record-delegation.js'
export {
  enqueueWorkspaceDelegation,
  type EnqueueWorkspaceDelegationInput,
  type DelegationOrigin,
} from './routing/enqueue-workspace-delegation.js'
export {
  enqueueSessionDelegation,
  type EnqueueSessionDelegationInput,
} from './routing/enqueue-session-delegation.js'
// Chat-mentions: a `@agent` mention becomes ONE deterministic background leaf
// run — the tick's agent-run branch consumes these rows.
export {
  enqueueAgentRun,
  type EnqueueAgentRunInput,
} from './routing/enqueue-agent-run.js'
// Session-comms (the revert flow): a child's report travels UP as a queued
// notify turn on the requester's conversation — the tick's report-delivery
// branch consumes these rows.
export {
  enqueueReportDelivery,
  type EnqueueReportDeliveryInput,
  type ReportDeliveryRequester,
} from './routing/enqueue-report-delivery.js'
// Persona-sessions: a child's spoken ACK/progress travels the same notify path
// as a report, but coalesces while pending and never marks the task reported —
// the tick's update-delivery branch consumes these rows.
export {
  enqueueUpdateDelivery,
  type EnqueueUpdateDeliveryInput,
} from './routing/enqueue-update-delivery.js'
export {
  consumeScheduleRunFailedEvent,
  type ScheduleRunFailedPayload,
} from './routing/consume-schedule-run-failed-event.js'

// The global-root catch-up (Ch3.5 root-awareness fix): the terminal delegations the root
// hasn't been told about, as a context block to prepend to its next turn.
export {
  collectDelegationReportsForRoot,
  type DelegationReportsForRoot,
} from './queries/collect-delegation-reports-for-root.js'
// The write-back half of that catch-up: mark the surfaced terminal delegations so the
// next collect skips them. The session-tier global-root runner calls it AFTER the turn
// absorbs the reports — paired with the read above.
export { markDelegationsSurfacedToRoot, markDelegationJobReported } from './repositories/index.js'
// The trace ANCHOR read — the session-tier trace view (apps' resolve-delegation-trace)
// starts from the job row keyed by partialSessionId, then composes chat reads itself.
// Only the anchor is exported; the composed VIEW stays out of this leaf (see below).
export { findDelegationJobByPartialSessionId } from './repositories/index.js'
export type { DelegationJobStatus, DelegationJobKind } from './schema/delegation-jobs.js'
// The kind-membership one home (persona-sessions): delivery vs work predicates
// — never re-spell kind literals at branch sites.
export {
  DELIVERY_JOB_KINDS,
  isDeliveryJobKind,
  isWorkJobKind,
} from './schema/delegation-jobs.js'
// The queue's CONSUMER half (brain-tree Ch1) — the app-tier delegation service
// claims one pending job per tick, runs it, and records the terminal state; at
// startup it fails the jobs a crash left stuck `claimed`. Re-exported (the
// findDelegationJobByPartialSessionId precedent) — repos stay in this leaf.
export {
  claimNextPendingDelegationJob,
  GLOBAL_ROOT_DELIVERY_TARGET_KEY,
  completeDelegationJob,
  failDelegationJob,
  requeueDelegationJob,
  failPendingDelegationJob,
  failOrphanedClaimedDelegations,
  requeueOrphanedClaimedReportDeliveries,
  findDelegationJobById,
  listDelegationJobsByThread,
  type DelegationJob,
} from './repositories/index.js'

// The user's in-flight delegations (Ch3.5) — drives the /global "Vynel is processing…" indicator.
export {
  listInFlightDelegations,
  type InFlightDelegation,
} from './queries/list-in-flight-delegations.js'

// The CHAIN key — one task and everything it caused, across every hop.
// `partialSessionId` stays per-hop (and every existing reader of it is
// unchanged); `threadId` is the outer envelope.
export { resolveThreadId, resolveThreadIdOf } from './routing/resolve-thread-id.js'
export {
  resolveThreadChain,
  type ThreadChain,
  type ThreadChainHop,
} from './queries/resolve-thread-chain.js'

// What an AGENT can read back about the work it handed off — the reads that make
// the `jobId` from send_task_to_workspace / send_task_to_session usable.
export {
  listBackgroundRuns,
  getBackgroundRun,
  type BackgroundRun,
  type BackgroundRunDetail,
  type BackgroundRunStatus,
} from './queries/list-background-runs.js'

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
// Surface-up approval: the parked-approval wait signal (the tick creates one per
// job and hands it to both the approval handler and routeRequest's wait clock) +
// the drain option types the api-side handler builder conforms to + the steer
// reason its fail-closed fallback denies with.
export { ApprovalWaitGate } from './routing/approval-wait-gate.js'
export {
  ROUTED_LEAF_APPROVAL_DENY_REASON,
  ROUTED_LEAF_MAX_CARDED_DENIALS,
  ROUTED_LEAF_WRITE_BLOCKED_NOTE,
  type DrainLeafTurnOptions,
} from './leaf/drain-leaf-turn.js'

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

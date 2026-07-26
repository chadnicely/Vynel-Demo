// The `@vynel/session/delegation` subpath — the delegation composition tier
// (brain-tree Chapters 1–4): routing a task INTO a workspace's continuing brain,
// running the durable delegation queue to terminal, surfacing carded approvals
// up to the origin channel, and reading a request's condensed trace back out.
//
// This is cross-domain composition BY DESIGN — it drives `@vynel/orchestration`'s
// queue with `@vynel/chat`'s shared consume pipeline and pushes into
// `@vynel/channels` — which is exactly why it lives in the session tier and not
// in any single leaf (the orchestration barrel's locked note: the delegation
// engine's only cross-dep stays `agents`; the session tier composes the rest).
// Like `./runtime`, it pulls db/providers and must never reach the web bundle.

export {
  delegateToWorkspaceRoot,
  type DelegateToWorkspaceRootInput,
  type DelegateToWorkspaceRootResult,
} from './delegate-to-workspace-root.js'
export {
  ROUTED_TASK_INSTRUCTIONS,
  REPORT_DELIVERY_INSTRUCTIONS,
  type RoutedTurnMcpAttachment,
} from './routed-turn-provider-input.js'
// Session-comms: the report-delivery notify branch's global-runner seam (the
// api edge implements it over runGlobalRootTurn) + the one-home spawned-name
// reading the /routing/report route shares with the tick's attribution.
export { type RunGlobalRootReportTurn } from './run-report-delivery-tick.js'
export { resolveSpawnedSessionDisplayName } from './resolve-spawned-session-name.js'
export {
  delegateToLeafSession,
  type DelegateToLeafSessionInput,
  type DelegateToLeafSessionResult,
} from './delegate-to-leaf-session.js'
export {
  delegateToSpawnedSession,
  type DelegateToSpawnedSessionInput,
  type DelegateToSpawnedSessionResult,
} from './delegate-to-spawned-session.js'
export {
  runDelegationClaimAndRunTick,
  type RunDelegationTickDeps,
} from './run-delegation-claim-and-run-tick.js'
export {
  buildRoutedApprovalHandler,
  type BuildRoutedApprovalHandlerDeps,
  type RoutedApprovalHandler,
  type RoutedApprovalOrigin,
} from './build-routed-approval-handler.js'
export {
  resolveDelegationTrace,
  type ResolveDelegationTraceInput,
  type DelegationTrace,
  type DelegationTraceEntry,
  type TraceEntryScope,
} from './resolve-delegation-trace.js'
export {
  TurnEventBroadcaster,
  traceChannelKey,
  type TurnEventSubscriber,
} from './turn-event-broadcaster.js'
export { attachDelegationTaskLabels } from './attach-delegation-task-labels.js'
export { attachDelegationToolOutcomes } from './attach-delegation-tool-outcomes.js'
export { attachSpawnedSessionNames } from './attach-spawned-session-names.js'
export {
  DelegationCancelRegistry,
  type DelegationCancelHandle,
  type RequestCancelResult,
} from './delegation-cancel-registry.js'
export { SessionTargetLocks } from './session-target-locks.js'

// The `@vynel/session/runtime` subpath — the session-execution surface, kept
// SEPARATE from the package barrel (`../index.ts`, which re-exports only the
// web-safe mode model). Importing the runtime pulls `@vynel/chat` /
// `@vynel/orchestration` / `@vynel/db` / `@vynel/providers`, so it must never
// reach the `apps/web` bundle — see
// `./session-types.ts` for why the barrel stays web-safe.

export type {
  SessionSink,
  RunGlobalRootTurnCoreDeps,
  RunGlobalRootTurnCoreInput,
  GlobalRootTarget,
} from './session-types.js'
export { runGlobalRootTurnCore } from './run-global-root-turn-core.js'

// The WORKSPACE turn runner — the workspace-chat SSE path reduces to this. The
// Slice-3 apps/api edge composes MCP + capabilities + agents, resolves the
// primary, and drives this generator (the workspace counterpart of the
// global-root core; it takes an OPAQUE pre-composed `mcpServers`).
export {
  startChatTurn,
  type StartChatTurnInput,
  type StartChatTurnDeps,
} from './start-chat-turn.js'

// Primary-as-thread resolution + continuity-application (the durable
// workspace-brain identity). Resolve the primary BEFORE the turn; link + apply
// the pressure-bridge AFTER it. The global-root sibling resolver is env-coupled
// (hidden cwd) so it stays at the apps/api edge, injected via `resolveTarget`.
export {
  resolvePrimaryConversationTarget,
  type PrimaryConversationTarget,
} from './resolve-primary-conversation.js'
export {
  applyPrimaryTurnContinuity,
  prepareTurnContinuity,
  runTurnContinuitySwap,
  type ApplyPrimaryTurnContinuityInput,
  type TurnContinuityPlan,
} from './apply-primary-turn-continuity.js'
// Continuity that RIDES a turn stream — the boundary step announced as
// `context-patching` / `context-patched` events on the same stream.
export {
  withBoundaryContinuity,
  type BoundaryContinuityInput,
  type BoundaryContinuityDeps,
} from './with-boundary-continuity.js'
export {
  bridgePrimarySessionAfterTurn,
  type BridgePrimarySessionAfterTurnInput,
  type BridgePrimarySessionAfterTurnDeps,
} from './bridge-primary-session-after-turn.js'
export {
  runSeededSwapSession,
  type RunSeededSwapSessionInput,
} from './run-seeded-swap-session.js'
// The contextBuilder — the ONE home composing the carry a fresh segment is
// seeded with (identity + summary + verbatim tail + refs + recovery), from the
// identity's own chain only.
export {
  buildContinuityContext,
  DEFAULT_TAIL_MESSAGE_LIMIT,
  type BuildContinuityContextInput,
  type BuildContinuityContextDeps,
  type ContinuityContext,
} from './build-continuity-context.js'
// Who a conversation is (one home for the carry's identity line + `whoami`),
// the duty-book binding, and the `whoami` report op.
export {
  describeContinuingIdentity,
  type ContinuingIdentityDescription,
} from './describe-continuing-identity.js'
export {
  resolveDutyBook,
  resolveDutyBookSlug,
  DUTY_BOOK_SLUGS,
  type DutyBook,
  type DutyBookKind,
} from './duty-book.js'
export {
  resolveWhoamiReport,
  type WhoamiReport,
  type WhoamiContextState,
  type ResolveWhoamiReportInput,
  type ResolveWhoamiReportDeps,
} from './resolve-whoami-report.js'

// The per-turn capability PROMPT contribution (Vynel operating-rules + each
// enabled capability's contribution). Composed at the edge, forwarded into the
// runner's `systemPromptAppend`.
export {
  composeSessionCapabilities,
  type ComposedSessionCapabilities,
} from './compose-session-capabilities.js'

// The continuing-thread settled-transcript read — ONE chain-walking resolver
// for both scopes (`/root/transcript` and the workspace
// `/chat/continuing/transcript`): a context-pressure swap must never empty
// the visible conversation. Plus the lean chain reads the swap carry and the
// delegation labels share (origin row / listed origin title / message tail).
export {
  resolveSessionChainOrigin,
  resolveListedOriginTitle,
  listSessionChainTailMessages,
  type SessionChainReadInput,
  resolvePrimaryTranscript,
  resolveSessionChainTranscript,
  type PrimaryTranscript,
  type ResolvePrimaryTranscriptInput,
  type SessionChainTranscript,
  type ResolveSessionChainTranscriptInput,
} from './resolve-primary-transcript.js'

// The per-user turn-liveness registry behind `GET /activity/stream` — every
// turn producer begins/ends here so any open UI surface learns a turn is
// running (channel turns, another tab's turns, schedule fires).
export {
  SessionActivityFeed,
  activityChannelKey,
  type BeginTurnActivityInput,
  type SessionTurnActivityHandle,
  type SessionTurnRecorder,
} from './session-activity-feed.js'
// The DB-backed durable-envelope recorder + its reads (persona-sessions): the
// api wires the recorder into the feed at boot and reaps orphans beside the
// tool-call reap; the running-turns read is the refresh/restart rebuild seed.
export { buildSessionTurnRecorder } from './session-turn-recorder.js'
export {
  reapOrphanedSessionTurns,
  listRunningSessionTurnsForUser,
  listLatestWorkspaceTurnsForUser,
  purgeEndedSessionTurnsBefore,
  type SessionTurnRow,
} from '../repositories/index.js'

// The session-keyed live turn channel (Watch everywhere, Slice ③) — runners
// tee their events through the wrapper; the SSE observe route subscribes by
// `sessionChannelKey`.
export {
  sessionChannelKey,
  publishTurnEventsToSessionChannel,
} from './session-turn-channel.js'

// The one ChatTurnEvent → feed-step mapping every producer taps through, so the
// feed narrates identically no matter which surface drove the turn.
export { publishTurnActivityStep, turnStepFromChatTurnEvent } from './activity-turn-steps.js'

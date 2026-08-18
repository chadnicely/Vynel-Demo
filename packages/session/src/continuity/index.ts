// Barrel of the `continuity` concern of `@vynel/session` — the durable-session
// identity + renew-before-compaction machinery. Re-exported through the package
// barrel (`@vynel/session`). Per `.claude/rules/structure-standard.md`.

export type { PrimarySessionRow, NewPrimarySessionRow } from './session-continuity-types.js'

export {
  getOrCreateContinuingSession,
  type GetOrCreateContinuingSessionInput,
} from './get-or-create-continuing-session.js'

export {
  getOrCreatePrimarySession,
  type GetOrCreatePrimarySessionInput,
} from './get-or-create-primary-session.js'

export {
  linkPrimarySessionToSdkSession,
  type LinkPrimarySessionToSdkSessionInput,
} from './link-primary-session-to-sdk-session.js'

export { findPrimaryConversation, type FindPrimaryConversationInput } from './find-primary-conversation.js'

// Published read surface for the monitor aggregator (reads primaries via this core
// op, not the repo — data-standard cross-domain rule).
export { listPrimarySessionsForUser } from './list-primary-sessions-for-user.js'

export {
  detectContextPressure,
  DEFAULT_CONTEXT_PRESSURE_THRESHOLD,
  type ContextMeasurement,
  type ContextPressure,
} from './detect-context-pressure.js'

export { type SessionStore, type SessionLocation, FilesystemSessionStore } from './session-store.js'

export {
  captureCompactionSummary,
  buildCompactionCapture,
  type CaptureCompactionSummaryInput,
} from './capture-compaction-summary.js'

export {
  bridgePrimarySession,
  bridgePrimarySessionIfUnderPressure,
  type BridgePrimarySessionInput,
  type BridgeOnPressureInput,
  type BridgePrimarySessionDeps,
  type BridgePrimarySessionResult,
} from './bridge-primary-session.js'

export {
  SESSION_COMPACTED_EVENT_TYPE,
  type SessionCompactedEventPayload,
  SESSION_SWAPPED_EVENT_TYPE,
  type SessionSwappedEventPayload,
  SESSION_SWAPPING_EVENT_TYPE,
  type SessionSwappingEventPayload,
  SESSION_SWAP_ABORTED_EVENT_TYPE,
  type SessionSwapAbortedEventPayload,
  type SessionSwapAbortedReason,
} from './session-continuity-events.js'

// The mid-turn context nudge (the provider's PostToolUse channel) + the
// pending-checkpoint register the `checkpoint` tool writes and the runners
// consume for the automatic continuation.
export {
  buildContextNudge,
  composeContextNudgeText,
  type ContextNudgeInput,
  type LiveContextState,
} from './context-nudge.js'
export {
  markPendingCheckpoint,
  peekPendingCheckpoint,
  takePendingCheckpoint,
  beginContinuation,
  beginGenuineTurn,
  markContinuationJob,
  takeContinuationJob,
  clearPendingCheckpoint,
  MAX_CONSECUTIVE_CONTINUATIONS,
  type PendingCheckpoint,
} from './pending-checkpoints.js'

// The process-wide "swapping right now" register — the streams read it when
// a turn parks behind an identity's lock (say "patching context", not "busy").
export {
  isPrimarySwapping,
  markPrimarySwapping,
  clearPrimarySwapping,
} from './swapping-primaries.js'

// The VOICE thread's read-side finder (voice-session arc) — re-exported here
// beside `findPrimaryConversation` so the api's UI doors resolve the spoken
// conversation without a repositories subpath.
export { findVoicePrimarySessionForUser } from '../repositories/primary-sessions.js'

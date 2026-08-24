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

// The first-turn bookkeeping (link + first-segment hide), run in-stream at
// `session-created` AND after the drain — idempotent, so a process death
// mid-first-turn never strands a room's conversation.
export {
  linkPrimaryToTurnSegment,
  hidesFirstSegment,
  type LinkPrimaryToTurnSegmentInput,
} from './link-primary-to-turn-segment.js'

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

// The one reading of a segment's context-window denominator + the model that
// grew its chain (the swap measurement and the fit guard both read it).
export { resolveSegmentContextWindow, type SegmentContextWindow } from './segment-context-window.js'

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
// DURABLE pending-checkpoint register (the identity's own row) the `checkpoint`
// tool writes and the runners consume for the automatic continuation, and the
// one visible way to give a checkpoint up.
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
  releaseContinuationJob,
  clearPendingCheckpoint,
  MAX_CONSECUTIVE_CONTINUATIONS,
  type PendingCheckpoint,
} from './pending-checkpoints.js'
export {
  dropPendingCheckpoint,
  dropContinuationJobCheckpoint,
  composeDroppedCheckpointNote,
  type DropPendingCheckpointInput,
  type DropPendingCheckpointReason,
} from './drop-pending-checkpoint.js'
export {
  recordNoteOnPrimaryHead,
  type RecordNoteOnPrimaryHeadInput,
  type RecordNoteOnPrimaryHeadOutcome,
} from './primary-head-note.js'
// The RESTART SURVIVOR (audit r2 R2-H): boot surfacing, the next turn's
// provider-input marker, and the out-loud supersession the `checkpoint` tool
// writes through.
export {
  surfaceCheckpointSurvivors,
  recordCheckpointSupersedingSurvivor,
  resolveSurvivorCheckpointMarker,
  composeSurvivorCheckpointMarker,
  composeSurvivedCheckpointNote,
  isSurvivorCheckpoint,
  type RecordCheckpointDeps,
  type SurfaceCheckpointSurvivorsDeps,
  type SurfaceCheckpointSurvivorsResult,
} from './checkpoint-survivors.js'

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

// The `@vynel/session/runtime` subpath — the session-execution surface, kept
// SEPARATE from the package barrel (`../index.ts`, which re-exports only the
// web-safe mode model). Importing the runtime pulls `@vynel/chat` /
// `@vynel/orchestration` / `@vynel/db` / `@vynel/providers`, so it must never
// reach the `apps/web` bundle — see
// `./session-types.ts` for why the barrel stays web-safe.

export type { SessionSink } from './session-types.js'
export {
  runGlobalRootTurnCore,
  type RunGlobalRootTurnCoreDeps,
  type RunGlobalRootTurnCoreInput,
  type GlobalRootTarget,
} from './run-global-root-turn-core.js'

// The WORKSPACE turn runner — the workspace-chat SSE path reduces to this. The
// Slice-3 apps/api edge composes MCP + capabilities + agents, resolves the
// primary, and drives this generator (the workspace counterpart of the
// global-root core; it takes an OPAQUE pre-composed `mcpServers`).
export { startChatTurn, type StartChatTurnInput } from './start-chat-turn.js'

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
  type ApplyPrimaryTurnContinuityInput,
} from './apply-primary-turn-continuity.js'
export {
  bridgePrimarySessionAfterTurn,
  type BridgePrimarySessionAfterTurnInput,
  type BridgePrimarySessionAfterTurnDeps,
} from './bridge-primary-session-after-turn.js'
export {
  runSeededSwapSession,
  type RunSeededSwapSessionInput,
} from './run-seeded-swap-session.js'

// The per-turn capability PROMPT contribution (Vynel operating-rules + each
// enabled capability's contribution). Composed at the edge, forwarded into the
// runner's `systemPromptAppend`.
export {
  composeSessionCapabilities,
  type ComposedSessionCapabilities,
} from './compose-session-capabilities.js'

// The global root's settled-transcript read (`/root/transcript`) — the
// continuity-anchored sibling of the workspace transcript reads.
export {
  resolveGlobalRootTranscript,
  type GlobalRootTranscript,
  type GlobalRootTranscriptMessage,
} from './resolve-global-root-transcript.js'

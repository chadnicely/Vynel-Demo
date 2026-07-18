// `runGlobalRootTurnCore` — the SHARED body of a global-root turn, living in
// `@vynel/session/runtime` so the backend has ONE session runner consumed from a
// package (the session-library migration). Both global-root turn paths in apps/api
// reduce to this one sink-parameterized core: the SSE web route
// (`streamGlobalRootTurn`) and the background channel runner (`runGlobalRootTurn`).
// They differ ONLY in the `SessionSink` they pass — stream the events to SSE, or
// accumulate them for a drained result.
//
// The env-coupled + composition pieces stay at the apps/api edge and are injected:
// - `deps.resolveTarget` get-or-creates the global root + the SDK session to resume
//   + ensures the hidden user-data cwd (apps/api owns the `VYNEL_USER_DATA_DIR`
//   read). Called INSIDE the lock — it reads `currentSdkSessionId`, so it must be
//   serialized with the resume/swap. Injection keeps this package env-free.
// - the pre-composed MCP attachment (`input.mcpServers` etc.) is built by the
//   caller (locked `api-side-turn-execution-with-mcp`); `wrapAppRequestWithOrigin`
//   + the origin header likewise stay at the edge — the core is origin-agnostic.
//
// SERIALIZED PER USER (brain-tree Ch4): the WHOLE turn runs under
// `runUnderRootTurnLock`. There is ONE root SDK session per user; a web turn racing
// a channel turn would clobber the session-swap write. The lock lives HERE and is
// the SOLE acquirer — the callers must NOT re-wrap it (it is a non-reentrant
// promise-chain serializer, so a nested same-user acquire would deadlock).

import type { Database } from '@vynel/db'
import { resolveAiAgentProvider, DEFAULT_PROVIDER_ID } from '@vynel/providers'
import {
  consumeSessionEventStream,
  attachedImagesMetadataFor,
  type AttachedImageBytes,
  type StructuralLogger,
} from '@vynel/chat'
import { collectDelegationReportsForRoot, markDelegationsSurfacedToRoot } from '@vynel/orchestration'
import { linkPrimarySessionToSdkSession } from '../continuity/index.js'
import type { SessionPermissionMode } from '../session-mode.js'
import type { SessionSink } from './session-types.js'
import { GLOBAL_ROOT_INSTRUCTIONS } from './global-root-instructions.js'
import { runUnderRootTurnLock } from './root-turn-lock.js'

/**
 * The resolved global-root conversation target — what `resolveTarget` returns.
 * Structurally mirrors apps/api's `GlobalRootConversationTarget` (kept structural —
 * the package must not import an apps/api type).
 */
export interface GlobalRootTarget {
  primarySessionId: string
  /** The SDK session the global root currently runs on — resume this. `null` on the
   *  first-ever turn (start fresh, then link). */
  resumeSdkSessionId: string | null
  /** The global root's SDK cwd — the hidden user-data dir (NOT a workspace). */
  workspacePath: string
}

export interface RunGlobalRootTurnCoreDeps {
  db: Database
  logger: StructuralLogger
  /**
   * Resolve (get-or-create) the global root + the SDK session to resume + the SDK
   * cwd, AND ensure the cwd exists on disk. Injected by apps/api (it owns the
   * env-coupled user-data-dir resolution + the get-or-create). Called INSIDE the
   * per-user lock.
   */
  resolveTarget: () => Promise<GlobalRootTarget>
}

export interface RunGlobalRootTurnCoreInput {
  userId: string
  userMessageText: string
  /** Attachments for this turn — inline base64; sent to the provider + persisted
   *  for re-display under the root's hidden user-data cwd (same D22 layout the
   *  workspace turn uses). */
  attachedImages?: AttachedImageBytes[]
  model?: string
  /** The provider permission mode for the brain's OWN tools this turn (the caller maps
   *  the user-facing `SessionMode` via `toPermissionMode`). Omit for the pre-mode
   *  default, `bypass-with-behavior-gate` — the brain's routing tools run silently and
   *  only the irreversible floor + declared mutating tools card. */
  permissionMode?: SessionPermissionMode
  /** Pre-composed MCP servers (composed by the apps/api caller — composition stays
   *  at the api edge per `api-side-turn-execution-with-mcp`). Opaque to the core. */
  mcpServers: Record<string, unknown>
  allowedMcpToolPatterns: string[]
  /** Feature-declared mutating tools that card even under bypass (additive to the floor). */
  mutatingToolNames: string[]
  /** The MCP/feature system-prompt contribution; the core prepends GLOBAL_ROOT_INSTRUCTIONS. */
  mcpSystemPromptAppend: string
  /** Enabled USER-scope agents (subagents) for this global session, composed at
   *  the api edge (`composeSessionAgents` with a null workspaceId) — same
   *  spawn lifecycle the workspace turn gets. Opaque here; the provider casts
   *  at the SDK edge (the `mcpServers` precedent). */
  agents?: Record<string, unknown>
  /** This turn arrived by VOICE — append the directive that makes the brain reply
   *  by CALLING the `speak` tool (the single voice) instead of writing prose. */
  voice?: boolean
  /** The inbound channel this turn arrived through — stamped on the persisted
   *  user row ("via Voice" / "via Telegram"). Set by the EDGES (the SSE route
   *  maps `voice`, the channel runner its kind); the core only passes it through. */
  originChannel?: 'voice' | 'telegram' | 'discord'
}

// Appended for a voice turn. The user hears you ONLY through the `speak` tool —
// your streamed text is never read aloud. So the reply must be MADE by calling
// speak, and what you pass it must sound like speech (short, plain, no markup).
const VOICE_TURN_INSTRUCTIONS = `This request came in by VOICE. The user HEARS you only when you call the \`speak\` tool — your normal text output is NOT read aloud.
- To reply, CALL \`speak\` with what you want said. Do this for every voice turn — a turn with no \`speak\` call is silent to the user.
- Pass ONE or TWO short spoken sentences: lead with the answer, plain conversational language, exactly as you'd say it out loud.
- NEVER put markdown, asterisks, bullet points, headings, tables, code, or URLs in \`speak\` — no symbols the ear can't hear.
- Do the work first (read tools, or route to a workspace for heavy tasks), THEN call \`speak\` with the spoken result. Keep any text answer brief; it's just the on-screen record.`

/**
 * Compose the turn's `systemPromptAppend`: the global-root instructions, the
 * feature/MCP contribution, and — for a voice turn — the spoken-style directive.
 */
function buildSystemPromptAppend(input: RunGlobalRootTurnCoreInput): string {
  const parts = [GLOBAL_ROOT_INSTRUCTIONS]
  if (input.mcpSystemPromptAppend !== '') parts.push(input.mcpSystemPromptAppend)
  if (input.voice === true) parts.push(VOICE_TURN_INSTRUCTIONS)
  return parts.join('\n\n')
}

/**
 * Run one global-root turn under the per-user lock, driving `sink` with the
 * provider's normalized events. Returns when the stream drains cleanly (then
 * `sink.onEnd`), or routes a thrown failure to `sink.onError` — re-throwing when
 * the sink declines to handle it (the drain path's contract).
 */
export async function runGlobalRootTurnCore(
  deps: RunGlobalRootTurnCoreDeps,
  input: RunGlobalRootTurnCoreInput,
  sink: SessionSink,
): Promise<void> {
  try {
    await runUnderRootTurnLock(input.userId, async () => {
      // Resolve (or create) the global root + the SDK session to resume + its hidden
      // SDK cwd (and ensure the dir exists). INSIDE the lock — it reads
      // `currentSdkSessionId`, so a wrapper around only the loop would resume stale.
      const target = await deps.resolveTarget()

      const provider = resolveAiAgentProvider(DEFAULT_PROVIDER_ID)
      const resumeSessionId = target.resumeSdkSessionId ?? undefined

      // Root-awareness catch-up (brain-tree Ch3.5): prepend unseen terminal reports to
      // the PROVIDER input ONLY (the persister keeps the clean original — else the block
      // renders as if the user typed it) + mark them surfaced (exactly-once — the
      // injected text reaches the SDK session, so marking at turn-build is correct).
      const reports = collectDelegationReportsForRoot(deps.db, { userId: input.userId })
      const providerUserMessageText =
        reports.contextBlock !== null
          ? `${reports.contextBlock}\n\n${input.userMessageText}`
          : input.userMessageText
      if (reports.jobIds.length > 0) {
        markDelegationsSurfacedToRoot(deps.db, reports.jobIds, new Date())
      }

      const attachedImages = input.attachedImages ?? []

      const sessionEventStream = provider.startChatSession({
        workspacePath: target.workspacePath,
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
        userMessageText: providerUserMessageText,
        ...(attachedImages.length > 0 ? { attachedImages } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        permissionMode: input.permissionMode ?? 'bypass-with-behavior-gate',
        // Empty native allowlist + the MCP wildcards => the routing tools (+ the
        // read-only desktop tools when present). The manager has no native tools.
        allowedToolNames: [],
        deniedToolNames: [],
        // SDK widening at the chat boundary — `StartChatSessionInput.mcpServers` is
        // `Record<string, unknown>`; the provider casts back at the SDK edge.
        mcpServers: input.mcpServers,
        allowedMcpToolPatterns: input.allowedMcpToolPatterns,
        // A feature's declared mutating tools card even under bypass (additive to
        // the static floor) — what makes the desktop act_on_app card once enabled.
        ...(input.mutatingToolNames.length > 0
          ? { alwaysRequireApprovalToolNames: input.mutatingToolNames }
          : {}),
        ...(input.agents !== undefined && Object.keys(input.agents).length > 0
          ? { agents: input.agents }
          : {}),
        systemPromptAppend: buildSystemPromptAppend(input),
        logger: deps.logger,
      })

      // Persist this turn's messages + translate to ChatTurnEvent through the ONE
      // shared path (the session unification). workspaceId null + scope 'global' (the
      // brain is the session ABOVE all workspaces); the brain's presentation (hidden,
      // 'Global brain', no auto-title) via newSessionOptions. The brain now persists
      // EVERYTHING a workspace session does — text, thinking, TOOL CALLS, usage — and
      // the sink receives the same `ChatTurnEvent` the workspace chat does, which is
      // what makes the brain chat render tool calls + thinking. The CLEAN user message
      // (NOT the catch-up block) is the persisted body.
      const turnStream = consumeSessionEventStream({
        db: deps.db,
        sessionEventStream,
        userMessageInput: {
          id: crypto.randomUUID(),
          body: input.userMessageText,
          attachedImagesMetadata: attachedImagesMetadataFor(attachedImages),
          ...(attachedImages.length > 0 ? { attachedImages } : {}),
          ...(input.originChannel !== undefined
            ? { originChannel: input.originChannel }
            : {}),
        },
        userId: input.userId,
        workspaceId: null,
        // The root's hidden user-data cwd — attachment bytes persist under its
        // D22 transcripts layout so a reopened brain thread can re-display them.
        workspacePath: target.workspacePath,
        providerId: DEFAULT_PROVIDER_ID,
        isNewSession: resumeSessionId === undefined,
        newSessionOptions: { visibility: 'hidden', title: 'Global brain', skipAutoTitle: true },
        logger: deps.logger,
      })

      for await (const event of turnStream) {
        // Link the root to the SDK session whenever a NEW (or compaction-swapped)
        // segment is created — `session-created` fires only on the new-session branch,
        // exactly when the root's currentSdkSessionId must advance to the live segment.
        // A normal resumed turn keeps the existing link. Best-effort — a link failure
        // must never break the live turn.
        if (event.kind === 'session-created') {
          try {
            linkPrimarySessionToSdkSession(deps.db, {
              primarySessionId: target.primarySessionId,
              userId: input.userId,
              sdkSessionId: event.session.id,
            })
          } catch (err) {
            deps.logger.warn({ err }, 'failed to link the global-root session')
          }
        }
        await sink.onEvent(event)
      }
      await sink.onEnd?.()
    })
  } catch (err) {
    if (sink.onError !== undefined) {
      await sink.onError(err)
    } else {
      throw err
    }
  }
}

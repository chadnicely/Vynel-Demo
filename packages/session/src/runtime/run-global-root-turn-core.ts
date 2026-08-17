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
// The runner contract types (`GlobalRootTarget`, the deps + input) live in
// `session-types.ts` — the runtime's type surface (file-size cap split).
//
// SERIALIZED PER USER (brain-tree Ch4): the WHOLE turn runs under
// `runUnderRootTurnLock`. There is ONE root SDK session per user; a web turn racing
// a channel turn would clobber the session-swap write. The lock lives HERE and is
// the SOLE acquirer — the callers must NOT re-wrap it (it is a non-reentrant
// promise-chain serializer, so a nested same-user acquire would deadlock).

import { resolveAiAgentProvider, DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { consumeSessionEventStream, attachedImagesMetadataFor } from '@vynel/chat'
import { buildCompactionCapture, linkPrimarySessionToSdkSession } from '../continuity/index.js'
import { withBoundaryContinuity } from './with-boundary-continuity.js'
import type {
  RunGlobalRootTurnCoreDeps,
  RunGlobalRootTurnCoreInput,
  SessionSink,
} from './session-types.js'
import { loadSessionInstruction } from '@vynel/instructions/session-instructions'
import { runUnderRootTurnLock } from './root-turn-lock.js'
import { publishTurnEventsToSessionChannel } from './session-turn-channel.js'
import { composeGlobalRootProviderMessage } from './compose-global-root-provider-message.js'

/**
 * Compose the turn's `systemPromptAppend`: the global-root instructions, the
 * feature/MCP contribution, and — for a voice turn — the spoken-style directive.
 * Both prompts are editable markdown loaded from
 * `@vynel/instructions/session-instructions`.
 */
function buildSystemPromptAppend(input: RunGlobalRootTurnCoreInput): string {
  const parts = [loadSessionInstruction('global-root')]
  if (input.mcpSystemPromptAppend !== '') parts.push(input.mcpSystemPromptAppend)
  if (input.voice === true) parts.push(loadSessionInstruction('voice-turn'))
  if (input.steerPromptAppend !== undefined && input.steerPromptAppend !== '') {
    parts.push(input.steerPromptAppend)
  }
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

      const provider = deps.provider ?? resolveAiAgentProvider(DEFAULT_PROVIDER_ID)
      const resumeSessionId = target.resumeSdkSessionId ?? undefined

      // The PROVIDER input — the clean text plus the per-message decorations
      // (delegation catch-up, voice/channel markers); the persister below keeps
      // the clean original. See `composeGlobalRootProviderMessage`.
      const providerUserMessageText = composeGlobalRootProviderMessage(deps.db, {
        userId: input.userId,
        userMessageText: input.userMessageText,
        ...(input.voice === true ? { voice: true } : {}),
        ...(input.channelReplyMarker !== undefined
          ? { channelReplyMarker: input.channelReplyMarker }
          : {}),
      })

      const attachedImages = input.attachedImages ?? []

      const sessionEventStream = provider.startChatSession({
        workspacePath: target.workspacePath,
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
        userMessageText: providerUserMessageText,
        ...(attachedImages.length > 0 ? { attachedImages } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {}),
        permissionMode: input.permissionMode ?? 'bypass-with-behavior-gate',
        // Empty native allowlist; the MCP servers register below and their
        // calls gate through the provider's canUseTool policy map. The
        // manager has no native tools.
        allowedToolNames: [],
        deniedToolNames: input.deniedMcpToolPatterns,
        // SDK widening at the chat boundary — `StartChatSessionInput.mcpServers` is
        // `Record<string, unknown>`; the provider casts back at the SDK edge.
        mcpServers: input.mcpServers,
        // A feature's declared mutating tools card even under bypass (additive to
        // the static floor) — what makes the desktop act_on_app card once enabled.
        ...(input.mutatingToolNames.length > 0
          ? { alwaysRequireApprovalToolNames: input.mutatingToolNames }
          : {}),
        ...(input.askModeApprovalToolNames.length > 0
          ? { askModeApprovalToolNames: input.askModeApprovalToolNames }
          : {}),
        ...(input.agents !== undefined && Object.keys(input.agents).length > 0
          ? { agents: input.agents }
          : {}),
        systemPromptAppend: buildSystemPromptAppend(input),
        logger: deps.logger,
        // Layer-1 capture (session.compacted) — the same hook the workspace
        // turn binds, so an SDK auto-compaction on the brain is recorded too.
        onCompaction: buildCompactionCapture(deps.db, { logger: deps.logger }),
        ...(input.onModelsDiscovered !== undefined
          ? { onModelsDiscovered: input.onModelsDiscovered }
          : {}),
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
        // Durability-first: a resumed turn's user row persists before provider
        // startup (the unbounded hang point), so a stuck start never loses it.
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
        newSessionOptions: { visibility: 'hidden', title: 'Global brain', skipAutoTitle: true },
        // The notify-turn attribution (session-comms) — absent on every other
        // turn, so the shipped rows stay byte-for-byte.
        ...(input.messageAttribution !== undefined
          ? { messageAttribution: input.messageAttribution }
          : {}),
        logger: deps.logger,
      })

      // Continuity at the turn boundary rides the stream — STILL under the
      // per-user lock, so a swap is serialized ahead of the brain's next turn
      // (the same one wrapper the workspace stream and the routed runners use).
      // Reads the segment's persisted occupancy; at ≥ 0.85 it announces
      // `context-patching`, distills + seed-fresh swaps, then `context-patched`
      // — the next turn resumes the fresh segment. Best-effort inside: the
      // turn already streamed, a failure is logged, never surfaced.
      const continuedStream = withBoundaryContinuity(
        turnStream,
        {
          primarySessionId: target.primarySessionId,
          priorSdkSessionId: target.resumeSdkSessionId,
          userId: input.userId,
          workspacePath: target.workspacePath,
          providerId: DEFAULT_PROVIDER_ID,
          ...(input.pressureThreshold !== undefined
            ? { threshold: input.pressureThreshold }
            : {}),
        },
        { db: deps.db, logger: deps.logger, provider },
      )
      // Tee onto the session's live channel when a broadcaster is wired —
      // the brain's turns are watchable like any other (Slice ③).
      const observedStream =
        deps.turnEvents !== undefined
          ? publishTurnEventsToSessionChannel(continuedStream, deps.turnEvents)
          : continuedStream
      for await (const event of observedStream) {
        // Link the root to the SDK session whenever a NEW (or compaction-swapped)
        // segment is created — `session-created` fires only on the new-session branch,
        // exactly when the root's currentSdkSessionId must advance to the live segment.
        // A normal resumed turn keeps the existing link. Best-effort — a link failure
        // must never break the live turn. (The boundary wrapper re-links as a
        // reconcile; this in-stream link is the durable one — it holds even if
        // the turn dies mid-way.)
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

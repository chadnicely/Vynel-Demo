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
// CHECKPOINT + AUTO-CONTINUE (session-continuity §4.6): the turn runs inside
// `runTurnWithContinuations` — when the model checkpointed (its context was
// nearly full), the boundary swap lands and a continuation turn runs on the
// fresh head, still under the same lock and into the same sink; the sink sees
// `… context-patched → user-message-persisted (the continuation's row) → …`.
//
// SERIALIZED PER IDENTITY (brain-tree Ch4, voice-session arc): the WHOLE turn
// runs under `runUnderRootTurnLock` — the user id keys the GLOBAL conversation
// (one root SDK session; a web turn racing a channel turn would clobber the
// session-swap write), `${userId}:voice` keys the spoken twin's own
// single-writer domain. The lock lives HERE and is the SOLE acquirer — the
// callers must NOT re-wrap it (it is a non-reentrant promise-chain serializer,
// so a nested same-key acquire would deadlock).

import { resolveAiAgentProvider, DEFAULT_PROVIDER_ID } from '@vynel/providers'
import {
  consumeSessionEventStream,
  attachedImagesMetadataFor,
  type ChatTurnEvent,
} from '@vynel/chat'
import type { AiAgentProvider, NormalizedSessionEvent } from '@vynel/providers'
import { markDelegationsSurfacedToRoot } from '@vynel/orchestration'
import {
  buildCompactionCapture,
  buildContextNudge,
  linkPrimarySessionToSdkSession,
} from '../continuity/index.js'
import { withBoundaryContinuity } from './with-boundary-continuity.js'
import { runTurnWithContinuations } from './run-turn-with-continuations.js'
import type { ContinuationTurn } from './continuation-turn.js'
import type {
  GlobalRootTarget,
  RunGlobalRootTurnCoreDeps,
  RunGlobalRootTurnCoreInput,
  SessionSink,
} from './session-types.js'
import {
  composeSessionInstruction,
  loadSessionInstruction,
} from '@vynel/instructions/session-instructions'
import { rootTurnLockKey, runUnderRootTurnLock } from './root-turn-lock.js'
import { DEFAULT_SESSION_MODE, toPermissionMode } from '../session-mode.js'
import { publishTurnEventsToSessionChannel } from './session-turn-channel.js'
import { composeGlobalRootProviderMessage } from './compose-global-root-provider-message.js'

/**
 * Compose the turn's `systemPromptAppend`. GLOBAL: the identity stack (`base`
 * + the `global-root` kind file, all editable markdown from
 * `@vynel/instructions/session-instructions`), then the feature/MCP
 * contribution and any per-turn steer. VOICE (the lean tier, 2026-08-27):
 * `voice-base` + the few-line `voice-thread` duty plus the steer — no
 * `global-root` kind file, no MCP feature sections; every standing token on
 * the spoken thread is paid on every request, and the tools speak for
 * themselves through their definitions.
 */
function buildSystemPromptAppend(input: RunGlobalRootTurnCoreInput): string {
  const parts =
    input.voice === true
      ? [loadSessionInstruction('voice-base'), loadSessionInstruction('voice-thread')]
      : [
          composeSessionInstruction('global-root'),
          ...(input.mcpSystemPromptAppend !== '' ? [input.mcpSystemPromptAppend] : []),
        ]
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
    // The voice thread is its OWN single-writer domain (voice-session arc):
    // one continuing session per identity, one lock per identity — a long
    // global turn no longer blocks speech, and vice versa. The channel runner
    // never sets voice, so channel/web global turns still fully serialize.
    const turnLockKey = rootTurnLockKey(input.userId, input.voice === true)
    // `lockWait` is the interactive stream's queue bound + cancel (R2-J);
    // omitted by every background caller, which keeps the unbounded chain.
    await runUnderRootTurnLock(turnLockKey, async () => {
      // Resolve (or create) the global root + the SDK session to resume + its hidden
      // SDK cwd (and ensure the dir exists). INSIDE the lock — it reads
      // `currentSdkSessionId`, so a wrapper around only the loop would resume stale.
      const target = await deps.resolveTarget()
      const provider = deps.provider ?? resolveAiAgentProvider(DEFAULT_PROVIDER_ID)

      // The genuine turn on the resolved head; each automatic continuation
      // re-resolves the head — the checkpoint's boundary swap moved it.
      const turnStream = runTurnWithContinuations({
        db: deps.db,
        primarySessionId: target.primarySessionId,
        runTurn: (continuation) =>
          continuation === null
            ? runOneGlobalTurn(deps, input, provider, target, null)
            : continueGlobalTurn(deps, input, provider, continuation),
        ...(input.autoContinue !== undefined ? { autoContinue: input.autoContinue } : {}),
        logger: deps.logger,
      })
      // Tee onto the session's live channel when a broadcaster is wired —
      // the brain's turns are watchable like any other (Slice ③).
      const observedStream =
        deps.turnEvents !== undefined
          ? publishTurnEventsToSessionChannel(turnStream, deps.turnEvents)
          : turnStream
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
    }, input.lockWait)
  } catch (err) {
    if (sink.onError !== undefined) {
      await sink.onError(err)
    } else {
      throw err
    }
  }
}

/** A continuation resumes the head the checkpoint's swap produced — re-read
 *  inside the lock, exactly like the genuine turn's resolve. */
async function* continueGlobalTurn(
  deps: RunGlobalRootTurnCoreDeps,
  input: RunGlobalRootTurnCoreInput,
  provider: AiAgentProvider,
  continuation: ContinuationTurn,
): AsyncIterable<ChatTurnEvent> {
  const head = await deps.resolveTarget()
  yield* runOneGlobalTurn(deps, input, provider, head, continuation)
}

/**
 * ONE provider turn on `target` — the genuine turn (`continuation` null) or an
 * automatic continuation — persisted through the shared consumer and wrapped in
 * the boundary continuity step. Yields the turn's events; the caller drives the
 * sink.
 */
async function* runOneGlobalTurn(
  deps: RunGlobalRootTurnCoreDeps,
  input: RunGlobalRootTurnCoreInput,
  provider: AiAgentProvider,
  target: GlobalRootTarget,
  continuation: ContinuationTurn | null,
): AsyncIterable<ChatTurnEvent> {
  const resumeSessionId = target.resumeSdkSessionId ?? undefined

  // The PROVIDER input — the clean text plus the per-message decorations
  // (delegation catch-up, voice/channel markers); the persister below keeps
  // the clean original. See `composeGlobalRootProviderMessage`. A continuation
  // hands the model its fuller instruction and persists its short anchor row
  // (and never re-collects the catch-up the genuine turn already carried).
  const { providerUserMessageText, catchUpJobIds } = composeGlobalRootProviderMessage(deps.db, {
    userId: input.userId,
    userMessageText: continuation?.providerText ?? input.userMessageText,
    primarySessionId: target.primarySessionId,
    ...(input.autoContinue !== undefined ? { autoContinue: input.autoContinue } : {}),
    ...(input.voice === true ? { voice: true } : {}),
    ...(input.autoBuildout === true ? { autoBuildout: true } : {}),
    ...(input.channelReplyMarker !== undefined
      ? { channelReplyMarker: input.channelReplyMarker }
      : {}),
    ...(continuation !== null ? { continuation: true } : {}),
  })
  const persistedUserMessageText = continuation?.persistedBody ?? input.userMessageText
  const messageAttribution = continuation?.attribution ?? input.messageAttribution

  // Attachments ride the genuine turn only.
  const attachedImages = continuation === null ? (input.attachedImages ?? []) : []

  const providerEventStream = provider.startChatSession({
    workspacePath: target.workspacePath,
    ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
    // The spoken thread runs on a BARE host (voice-lean tier): no CLAUDE.md,
    // no user/workspace settings, no native toolset — the MCP servers below
    // are its entire tool surface, and Vynel's own prompt its entire identity.
    ...(input.voice === true ? { hostResources: 'none' as const } : {}),
    // Thinking rides the resolved settings (the `voiceTierThinking`
    // preference, default 'off' — a thought block is dead air on a spoken
    // surface; a user who prefers depth picks a level in Settings → Voice).
    // On a VOICE turn the core BACKSTOPS the default: a spoken turn whose
    // caller resolved nothing never thinks (review SF1 — the guarantee stays
    // structural, not caller-remembered); an explicit `false` (a picked
    // level) passes through.
    ...(input.voice === true
      ? { disableThinking: input.disableThinking ?? true }
      : input.disableThinking === true
        ? { disableThinking: true }
        : {}),
    userMessageText: providerUserMessageText,
    ...(attachedImages.length > 0 ? { attachedImages } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {}),
    // The one default (D3): a caller that resolved nothing runs `auto` —
    // never the provider's `bypass-with-behavior-gate` any more.
    permissionMode: input.permissionMode ?? toPermissionMode(DEFAULT_SESSION_MODE),
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
    // The mid-turn context nudge — armed at the same threshold the
    // boundary swap uses (§4.6): the model learns it is near the limit
    // and checkpoints instead of running into it. Not on a delivery turn
    // (nothing to continue).
    ...(input.autoContinue !== false
      ? {
          onToolResultContext: buildContextNudge(
            input.pressureThreshold !== undefined ? { threshold: input.pressureThreshold } : {},
          ),
        }
      : {}),
    ...(input.onModelsDiscovered !== undefined
      ? { onModelsDiscovered: input.onModelsDiscovered }
      : {}),
    ...(input.onRateLimitReported !== undefined
      ? { onRateLimitReported: input.onRateLimitReported }
      : {}),
  })
  // The catch-up reports are marked surfaced ONLY once the turn is provably
  // underway — the provider's `session-started` (session-hardening A4): the
  // injected block is in the SDK session from that instant, so exactly-once
  // holds; a startup failure (engine unreachable, model rejected, prompt too
  // long) before it leaves the reports collectable for the next turn instead
  // of losing every failure notice and `direct_to_user` answer forever
  // (audit G2, reproduced). Marking at compose time was that loss.
  const sessionEventStream =
    catchUpJobIds.length > 0
      ? markCatchUpSurfacedOnSessionStarted(providerEventStream, () => {
          try {
            markDelegationsSurfacedToRoot(deps.db, catchUpJobIds, new Date())
          } catch (err) {
            // Best-effort: the turn already carries the block; a failed mark
            // means the next turn re-injects it (a repeat, never a loss).
            deps.logger.warn({ err }, 'failed to mark the catch-up reports surfaced')
          }
        })
      : providerEventStream

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
      // A continuation persists its own anchor row — never the genuine turn's id.
      id: continuation === null ? (input.userMessageId ?? crypto.randomUUID()) : crypto.randomUUID(),
      body: persistedUserMessageText,
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
    // The voice thread wears its own name + scope; every scope view excludes
    // 'voice', so the spoken chain stays invisible until a Voice-chat menu
    // ships. Swap segments inherit the scope from their predecessor.
    newSessionOptions:
      input.voice === true
        ? { visibility: 'hidden', title: 'Voice conversation', skipAutoTitle: true, scope: 'voice' }
        : { visibility: 'hidden', title: 'Global brain', skipAutoTitle: true },
    // The notify-turn attribution (session-comms) / the continuation's
    // relayed-anchor stamp — absent on every other turn, so the shipped
    // rows stay byte-for-byte.
    ...(messageAttribution !== undefined ? { messageAttribution } : {}),
    logger: deps.logger,
  })

  // Continuity at the turn boundary rides the stream — STILL under the
  // per-user lock, so a swap is serialized ahead of the brain's next turn
  // (the same one wrapper the workspace stream and the routed runners use).
  // Reads the segment's persisted occupancy; at ≥ 0.85 it announces
  // `context-patching`, distills + seed-fresh swaps, then `context-patched`
  // — the next turn resumes the fresh segment. Best-effort inside: the
  // turn already streamed, a failure is logged, never surfaced.
  yield* withBoundaryContinuity(
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
}

/** Pass the provider stream through untouched, firing `onStarted` once on the
 *  first `session-started` — the earliest moment the turn's input provably
 *  reached the SDK session. */
async function* markCatchUpSurfacedOnSessionStarted(
  providerEventStream: AsyncIterable<NormalizedSessionEvent>,
  onStarted: () => void,
): AsyncIterable<NormalizedSessionEvent> {
  let started = false
  for await (const event of providerEventStream) {
    if (!started && event.kind === 'session-started') {
      started = true
      onStarted()
    }
    yield event
  }
}

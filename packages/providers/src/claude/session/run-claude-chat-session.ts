// `runClaudeChatSession` — the `async function*` that wraps the Claude Agent
// SDK's `query()`. It translates native `SDKMessage`s to
// `NormalizedSessionEvent`s and interleaves synthetic approval events from the
// `SyntheticEventQueue`. The `try/finally` guarantees registry + temp-file
// cleanup even when the consumer abandons iteration (e.g. an SSE disconnect).
// See `docs/blueprints/providers/blueprint.md §11.2` + `§14.1`.

import { query } from '../base/claude-agent-sdk.js'
import type { SDKMessage } from '../base/claude-agent-sdk.js'
import type { ActiveSessionRegistry } from '../../shared/active-session-registry.js'
import type { NormalizedSessionEvent } from '../../shared/normalized-session-event.js'
import type { PendingApprovalRegistry } from '../../shared/pending-approval-registry.js'
import type { StartChatSessionInput } from '../../shared/start-chat-session-input.js'
import { buildClaudeCanUseToolCallback } from '../approvals/build-claude-can-use-tool-callback.js'
import { buildClaudePostCompactHook } from '../approvals/build-claude-post-compact-hook.js'
import {
  buildClaudePostToolUseHook,
  type LiveContextHolder,
} from '../approvals/build-claude-post-tool-use-hook.js'
import { buildClaudeSdkOptions, SDK_PERMISSION_MODE } from '../base/build-claude-sdk-options.js'
import {
  isMainThreadContentDelta,
  readAssistantMessageIdFromStreamStart,
  readResultError,
} from '../base/claude-sdk-message-readers.js'
import { handleAttachedImages } from '../base/handle-attached-images.js'
import { mapClaudeModelInfo } from '../base/map-claude-model-info.js'
import { SyntheticEventQueue } from './synthetic-event-queue.js'
import { translateClaudeSdkEvent } from '../base/translate-claude-sdk-event.js'

export type RunClaudeChatSessionDependencies = {
  input: StartChatSessionInput
  activeSessionRegistry: ActiveSessionRegistry
  pendingApprovalRegistry: PendingApprovalRegistry
}

// How long session startup (CLI spawn + auth + resume validation) may take
// before the turn fails loud. Generous — a cold start on a slow disk is tens
// of seconds — but finite: an unbounded first pull is how "stuck forever with
// the message unpersisted" happened.
export const SESSION_STARTUP_TIMEOUT_MS = 90_000

// How long a stop waits for the CLI's own interrupt to land before it aborts
// anyway. Short enough to feel instant, long enough for the control message
// to reach a healthy runtime.
export const INTERRUPT_GRACE_MS = 250

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function describeThrownError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return { code: error.name.length > 0 ? error.name : 'session_error', message: error.message }
  }
  return { code: 'session_error', message: String(error) }
}

export async function* runClaudeChatSession(
  deps: RunClaudeChatSessionDependencies,
): AsyncIterable<NormalizedSessionEvent> {
  const { input, activeSessionRegistry, pendingApprovalRegistry } = deps

  const sessionIdHolder: { current: string | null } = { current: null }
  const syntheticEventQueue = new SyntheticEventQueue<NormalizedSessionEvent>()
  // Optional fields are spread conditionally — `exactOptionalPropertyTypes`
  // rejects a literal `field: undefined` against an optional `field?: T`.
  const imageHandling = await handleAttachedImages({
    userMessageText: input.userMessageText,
    ...(input.attachedImages !== undefined ? { attachedImages: input.attachedImages } : {}),
  })
  const abortController = new AbortController()

  // The mode the gates actually gate on. It starts as the turn's mode and
  // MOVES when the user switches mid-run — both approval gates read through
  // it, so Ask starts carding the next tool call rather than the next turn.
  const livePermissionMode = { current: input.permissionMode }

  // Set the moment the user stops the turn. The CLI answers our interrupt
  // with an ERROR-shaped result ("Operation aborted") — that is the stop's
  // own footprint, not a failure, and the room must not read "hit a problem"
  // because the user pressed Stop.
  let stopRequested = false

  // Per-turn feature mutating tools (e.g. desktop act_on_app) → carded in every
  // carding mode, UNIONED with the static floor in BOTH the PreToolUse hook +
  // the canUseTool callback. Convert once; pass to both so gate + backstop
  // share it. ADDITIVE — omitting it never drops the static floor.
  const alwaysRequireApprovalToolNames =
    input.alwaysRequireApprovalToolNames !== undefined ? new Set(input.alwaysRequireApprovalToolNames) : undefined
  // Ask-mode-only destructive tier — consumed by the PreToolUse backstop AND
  // `canUseTool`: with no MCP wildcards in `allowedTools`, every MCP call
  // reaches the callback, and the policy map (not an upstream pre-approval)
  // decides which card in ask mode (`tool-approval-policy.ts`).
  const askModeApprovalToolNames =
    input.askModeApprovalToolNames !== undefined ? new Set(input.askModeApprovalToolNames) : undefined
  // The session's live context occupancy, as the usage translation sees it —
  // the mid-turn nudge hook reads it when a tool result lands.
  const liveContext: LiveContextHolder = { current: null }

  const sdkOptions = buildClaudeSdkOptions({
    workspacePath: input.workspacePath,
    permissionMode: input.permissionMode,
    readPermissionMode: () => livePermissionMode.current,
    allowedToolNames: input.allowedToolNames,
    deniedToolNames: input.deniedToolNames,
    ...(alwaysRequireApprovalToolNames !== undefined ? { alwaysRequireApprovalToolNames } : {}),
    ...(askModeApprovalToolNames !== undefined ? { askModeApprovalToolNames } : {}),
    ...(input.resumeSessionId !== undefined ? { resumeSessionId: input.resumeSessionId } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {}),
    ...(input.mcpServers !== undefined
      ? {
          mcpServers: input.mcpServers as Parameters<typeof buildClaudeSdkOptions>[0]['mcpServers'],
        }
      : {}),
    ...(input.systemPromptAppend !== undefined
      ? { systemPromptAppend: input.systemPromptAppend }
      : {}),
    ...(input.agents !== undefined
      ? { agents: input.agents as Parameters<typeof buildClaudeSdkOptions>[0]['agents'] }
      : {}),
    // Session-continuity Layer 1 (Q2): bind the PostCompact capture hook
    // when the caller supplied an onCompaction callback. Best-effort — the
    // hook logs + never throws (build-claude-post-compact-hook).
    ...(input.onCompaction !== undefined
      ? {
          postCompactHook: buildClaudePostCompactHook(
            input.onCompaction,
            input.logger !== undefined ? { logger: input.logger } : {},
          ),
        }
      : {}),
    // Session-continuity's mid-turn context channel — bound only when the
    // caller supplied a callback (a plain conversation says nothing).
    ...(input.onToolResultContext !== undefined
      ? {
          postToolUseHook: buildClaudePostToolUseHook(
            input.onToolResultContext,
            liveContext,
            input.logger !== undefined ? { logger: input.logger } : {},
          ),
        }
      : {}),
  })
  sdkOptions.abortController = abortController
  // Bound in EVERY mode, bypass included (Chad, 2026-08-25). While the turn
  // is actually in bypass the callback stays dead either way — the SDK
  // auto-approves before consulting it — so binding costs only the SDK's
  // shadowed-callback warning. It buys the thing he asked for: switching out
  // of bypass mid-run starts carding immediately, where skipping the bind
  // left a turn that could never card no matter what the user chose.
  {
    // The composed server names scope the ask-mode map-allow: only Vynel's own
    // registered servers inherit the old wildcard's blanket; an external
    // settings-loaded server's tools keep carding, as they always did.
    const composedMcpServerNames =
      input.mcpServers !== undefined ? new Set(Object.keys(input.mcpServers)) : undefined
    sdkOptions.canUseTool = buildClaudeCanUseToolCallback({
      pendingApprovalRegistry,
      permissionMode: () => livePermissionMode.current,
      sessionIdHolder,
      syntheticEventQueue,
      ...(alwaysRequireApprovalToolNames !== undefined ? { alwaysRequireApprovalToolNames } : {}),
      ...(askModeApprovalToolNames !== undefined ? { askModeApprovalToolNames } : {}),
      ...(composedMcpServerNames !== undefined ? { composedMcpServerNames } : {}),
    })
  }

  const queryInstance = query({ prompt: imageHandling.modifiedPrompt, options: sdkOptions })

  let sessionId = ''
  let isRegistered = false
  let currentAssistantMessageId: string | null = null
  // The ids whose text/thinking streamed as deltas — the translator replays a
  // complete assistant message's blocks only when its id is NOT here (the
  // CLI's non-streaming fallback surfaces the message with no deltas at all).
  const streamedAssistantMessageIds = new Set<string>()
  let latestResultMessage: SDKMessage | null = null
  // Both pending promises persist across loop iterations — a fresh
  // `queryInstance.next()` every iteration would queue an extra request on the
  // iterator and silently drop the SDK message that resolves the abandoned one.
  let pendingSdkNext: Promise<IteratorResult<SDKMessage, void>> | null = null
  let pendingDequeue: Promise<NormalizedSessionEvent> | null = null

  try {
    // The SDK assigns the session id on its first message; every `SDKMessage`
    // carries it. The first message is the `system`/`init` message.
    //
    // BOUNDED: this first pull is the subprocess spawn + auth + resume-
    // validation round trip — historically unbounded, and the hang point
    // behind "stuck first message on an existing session". Past the deadline,
    // abort the query and surface a typed, actionable error instead of an
    // eternally-open stream.
    let startupTimer: ReturnType<typeof setTimeout> | undefined
    const firstResult = await Promise.race([
      queryInstance.next(),
      new Promise<'startup-timeout'>((resolve) => {
        startupTimer = setTimeout(() => resolve('startup-timeout'), SESSION_STARTUP_TIMEOUT_MS)
        startupTimer.unref?.()
      }),
    ])
    if (startupTimer !== undefined) clearTimeout(startupTimer)
    if (firstResult === 'startup-timeout') {
      abortController.abort()
      yield {
        kind: 'session-errored',
        sessionId: '',
        errorCode: 'provider_start_timeout',
        errorMessage:
          `The Claude engine did not respond within ${SESSION_STARTUP_TIMEOUT_MS / 1000}s ` +
          'while starting the session. Check that the engine is running and signed in, then send again.',
        isRecoverable: true,
        erroredAt: new Date(),
      }
      return
    }
    if (firstResult.done) {
      yield {
        kind: 'session-errored',
        sessionId: '',
        errorCode: 'empty_session',
        errorMessage: 'The runtime produced no session events.',
        isRecoverable: false,
        erroredAt: new Date(),
      }
      return
    }
    // SDK 0.3.x widened `SDKMessage.session_id` to optional (the union now
    // includes message types that may omit it). The first message is the
    // system/init message, which always carries the id — treat a missing id as
    // an error rather than coercing to a bad empty-string session.
    const firstSessionId = firstResult.value.session_id
    if (firstSessionId === undefined) {
      yield {
        kind: 'session-errored',
        sessionId: '',
        errorCode: 'missing_session_id',
        errorMessage: 'The runtime did not assign a session id.',
        isRecoverable: false,
        erroredAt: new Date(),
      }
      return
    }
    sessionId = firstSessionId
    sessionIdHolder.current = sessionId
    activeSessionRegistry.register({
      sessionId,
      startedAt: new Date(),
      // Stop has to bite NOW, including mid-tool (Chad, 2026-08-25: "it needs
      // to stop IMMEDIATELY, no delay"). Aborting alone only unwinds OUR
      // iteration — a long-running Bash keeps going inside the CLI until it
      // returns on its own, which is the delay he is describing. The SDK's
      // control-protocol interrupt reaches the CLI mid-tool, so we send that
      // first and abort straight after; the race is bounded so a runtime that
      // never answers cannot hold the stop open.
      cancel: async () => {
        stopRequested = true
        try {
          await Promise.race([
            queryInstance.interrupt(),
            new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, INTERRUPT_GRACE_MS)
              timer.unref?.()
            }),
          ])
        } catch (error: unknown) {
          // A runtime that cannot be interrupted still gets aborted below.
          input.logger?.warn(
            { err: error, sessionId },
            'runtime interrupt failed — aborting the turn anyway',
          )
        }
        abortController.abort()
      },
      // Live mode switching, both halves: the SDK's own gate moves, AND the
      // holder both Vynel gates read moves with it. The SDK goes first — a
      // switch it refuses (into bypass, which it only grants to a turn that
      // started there) must not leave Vynel's gates disagreeing with it.
      setPermissionMode: async (mode) => {
        await queryInstance.setPermissionMode(SDK_PERMISSION_MODE[mode])
        livePermissionMode.current = mode
      },
    })
    isRegistered = true

    yield {
      kind: 'session-started',
      sessionId,
      resumedFromExisting: input.resumeSessionId !== undefined,
      startedAt: new Date(),
    }

    // Model-roster discovery (best-effort, the onCompaction shape): the CLI's
    // initialize response — already in flight by the first message — carries
    // the models this engine + account actually serve. Detached on purpose:
    // a slow or failed control read must never stall or fail the user's turn.
    if (input.onModelsDiscovered !== undefined) {
      const onModelsDiscovered = input.onModelsDiscovered
      void queryInstance
        .initializationResult()
        .then((initialization) => onModelsDiscovered(mapClaudeModelInfo(initialization.models)))
        .catch((error: unknown) => {
          input.logger?.warn({ error: String(error) }, 'model-roster discovery failed')
        })
    }

    // Process the already-read first message (the translator yields nothing for
    // the `system`/`init` message — but processing keeps the loop uniform).
    currentAssistantMessageId =
      readAssistantMessageIdFromStreamStart(firstResult.value) ?? currentAssistantMessageId
    if (firstResult.value.type === 'result') latestResultMessage = firstResult.value
    for (const normalizedEvent of translateClaudeSdkEvent({
      sdkEvent: firstResult.value,
      sessionId,
      currentAssistantMessageId,
      streamedAssistantMessageIds,
    })) {
      yield normalizedEvent
    }

    // Interleave SDK messages with synthetic approval events.
    while (true) {
      pendingSdkNext ??= queryInstance.next()
      pendingDequeue ??= syntheticEventQueue.dequeue()
      const raceWinner = await Promise.race([
        pendingSdkNext.then((sdkResult) => ({ source: 'sdk' as const, sdkResult })),
        pendingDequeue.then((syntheticEvent) => ({ source: 'synthetic' as const, syntheticEvent })),
      ])

      if (raceWinner.source === 'synthetic') {
        pendingDequeue = null
        yield raceWinner.syntheticEvent
        continue
      }

      pendingSdkNext = null
      if (raceWinner.sdkResult.done) break

      const sdkMessage = raceWinner.sdkResult.value
      currentAssistantMessageId =
        readAssistantMessageIdFromStreamStart(sdkMessage) ?? currentAssistantMessageId
      if (currentAssistantMessageId !== null && isMainThreadContentDelta(sdkMessage)) {
        streamedAssistantMessageIds.add(currentAssistantMessageId)
      }
      if (sdkMessage.type === 'result') latestResultMessage = sdkMessage
      // Subscription-limit reporting (best-effort, the onModelsDiscovered
      // shape): the runtime announces the account's window state mid-stream;
      // the caller persists the reading for the popup's Limits tab. Detached
      // on purpose — a failed persist must never stall or fail the turn.
      if (sdkMessage.type === 'rate_limit_event' && input.onRateLimitReported !== undefined) {
        const onRateLimitReported = input.onRateLimitReported
        const info = sdkMessage.rate_limit_info
        if (info.rateLimitType !== undefined) {
          void Promise.resolve(
            onRateLimitReported({
              windowKind: info.rateLimitType,
              status: info.status,
              utilization: typeof info.utilization === 'number' ? info.utilization : null,
              // Epoch seconds per the unified rate-limit headers — but guard
              // for millis (an already-13-digit value must not land in 57000).
              resetsAt:
                typeof info.resetsAt === 'number'
                  ? new Date(info.resetsAt > 1e12 ? info.resetsAt : info.resetsAt * 1000)
                  : null,
            }),
          ).catch((error: unknown) => {
            input.logger?.warn({ error: String(error) }, 'rate-limit reporting failed')
          })
        }
      }
      for (const normalizedEvent of translateClaudeSdkEvent({
        sdkEvent: sdkMessage,
        sessionId,
        currentAssistantMessageId,
        streamedAssistantMessageIds,
      })) {
        // The same occupancy the chat consumer persists — the LAST assistant
        // request's input side — kept live for the mid-turn nudge hook.
        if (normalizedEvent.kind === 'usage-reported') {
          liveContext.current = {
            usedTokens:
              normalizedEvent.inputTokens +
              (normalizedEvent.cacheReadInputTokens ?? 0) +
              (normalizedEvent.cacheCreationInputTokens ?? 0),
            model: normalizedEvent.model ?? liveContext.current?.model ?? null,
          }
        }
        yield normalizedEvent
      }
    }

    // Flush synthetic events the race left un-yielded. The outstanding
    // `dequeue()` may hold one resolved event; it never resolves later — once
    // the SDK is done no further `canUseTool` can fire. Probe it against a
    // macrotask so an already-resolved value is detected without hanging.
    if (pendingDequeue !== null) {
      const drained = await Promise.race([
        pendingDequeue.then((syntheticEvent) => ({ syntheticEvent })),
        new Promise<{ syntheticEvent: null }>((resolve) => {
          setImmediate(() => resolve({ syntheticEvent: null }))
        }),
      ])
      if (drained.syntheticEvent !== null) yield drained.syntheticEvent
    }
    while (!syntheticEventQueue.isEmpty()) {
      yield await syntheticEventQueue.dequeue()
    }

    const resultError = readResultError(latestResultMessage)
    if (resultError !== null && stopRequested) {
      // The CLI's answer to the stop the user asked for — interrupted, not
      // errored. (A turn that finished cleanly in the same instant still
      // reports as completed below: nothing of it was lost.)
      yield { kind: 'session-interrupted', sessionId, interruptedAt: new Date() }
    } else if (resultError !== null) {
      yield {
        kind: 'session-errored',
        sessionId,
        errorCode: resultError.code,
        errorMessage: resultError.message,
        isRecoverable: false,
        erroredAt: new Date(),
      }
    } else {
      yield {
        kind: 'session-completed',
        sessionId,
        isNewSession: input.resumeSessionId === undefined,
        completedAt: new Date(),
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      yield { kind: 'session-interrupted', sessionId, interruptedAt: new Date() }
    } else {
      const { code, message } = describeThrownError(error)
      // Phase 1 surfaces every thrown error as non-recoverable — the user
      // re-runs the turn; an error-recoverability taxonomy is deferred.
      yield {
        kind: 'session-errored',
        sessionId,
        errorCode: code,
        errorMessage: message,
        isRecoverable: false,
        erroredAt: new Date(),
      }
    }
  } finally {
    if (isRegistered) {
      activeSessionRegistry.unregister(sessionId)
      pendingApprovalRegistry.cancelAllForSession(sessionId)
    }
    // Idempotent — a no-op if the query already completed; stops the SDK when
    // the consumer abandoned iteration mid-session.
    abortController.abort()
    syntheticEventQueue.close()
    await imageHandling.cleanup()
  }
}

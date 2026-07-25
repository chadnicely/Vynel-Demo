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
import { buildClaudeSdkOptions } from '../base/build-claude-sdk-options.js'
import {
  readAssistantMessageIdFromStreamStart,
  readResultError,
} from '../base/claude-sdk-message-readers.js'
import { handleAttachedImages } from '../base/handle-attached-images.js'
import { SyntheticEventQueue } from './synthetic-event-queue.js'
import { translateClaudeSdkEvent } from '../base/translate-claude-sdk-event.js'

export type RunClaudeChatSessionDependencies = {
  input: StartChatSessionInput
  activeSessionRegistry: ActiveSessionRegistry
  pendingApprovalRegistry: PendingApprovalRegistry
}

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

  // Per-turn feature mutating tools (e.g. desktop act_on_app) → carded EVEN under
  // bypass, UNIONED with the static floor in BOTH the PreToolUse hook + the
  // canUseTool callback. Convert once; pass to both so gate + backstop share it.
  // ADDITIVE — omitting it never drops the static floor.
  const alwaysRequireApprovalToolNames =
    input.alwaysRequireApprovalToolNames !== undefined ? new Set(input.alwaysRequireApprovalToolNames) : undefined
  // Ask-mode-only destructive tier — consumed by the PreToolUse backstop alone.
  // Deliberately NOT passed to `canUseTool`: in ask mode everything that reaches
  // the callback cards anyway, and in bypass these tools must stay uncarded.
  const askModeApprovalToolNames =
    input.askModeApprovalToolNames !== undefined ? new Set(input.askModeApprovalToolNames) : undefined

  const sdkOptions = buildClaudeSdkOptions({
    workspacePath: input.workspacePath,
    permissionMode: input.permissionMode,
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
    ...(input.allowedMcpToolPatterns !== undefined
      ? { allowedMcpToolPatterns: input.allowedMcpToolPatterns }
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
  })
  sdkOptions.abortController = abortController
  sdkOptions.canUseTool = buildClaudeCanUseToolCallback({
    pendingApprovalRegistry,
    permissionMode: input.permissionMode,
    sessionIdHolder,
    syntheticEventQueue,
    ...(alwaysRequireApprovalToolNames !== undefined ? { alwaysRequireApprovalToolNames } : {}),
  })

  const queryInstance = query({ prompt: imageHandling.modifiedPrompt, options: sdkOptions })

  let sessionId = ''
  let isRegistered = false
  let currentAssistantMessageId: string | null = null
  let latestResultMessage: SDKMessage | null = null
  // Both pending promises persist across loop iterations — a fresh
  // `queryInstance.next()` every iteration would queue an extra request on the
  // iterator and silently drop the SDK message that resolves the abandoned one.
  let pendingSdkNext: Promise<IteratorResult<SDKMessage, void>> | null = null
  let pendingDequeue: Promise<NormalizedSessionEvent> | null = null

  try {
    // The SDK assigns the session id on its first message; every `SDKMessage`
    // carries it. The first message is the `system`/`init` message.
    const firstResult = await queryInstance.next()
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
      cancel: async () => {
        abortController.abort()
      },
    })
    isRegistered = true

    yield {
      kind: 'session-started',
      sessionId,
      resumedFromExisting: input.resumeSessionId !== undefined,
      startedAt: new Date(),
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
      if (sdkMessage.type === 'result') latestResultMessage = sdkMessage
      for (const normalizedEvent of translateClaudeSdkEvent({
        sdkEvent: sdkMessage,
        sessionId,
        currentAssistantMessageId,
      })) {
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
    if (resultError !== null) {
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

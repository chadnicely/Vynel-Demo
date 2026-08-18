// `translateClaudeSdkEvent` — the single source of truth for the
// `SDKMessage` -> `NormalizedSessionEvent[]` mapping. A PURE transformer:
// same input -> same output, never throws, unknown shapes -> `[]`.
//
// Event-ownership split (see blueprint §11.2/§11.3 + the Implement-step-12
// design): this translator emits CONTENT events only. Session-lifecycle
// events (`session-started`/`-completed`/`-interrupted`/`-errored`) are
// synthesized by `runClaudeChatSession`, which owns the SDK-conversation
// state. Sourcing:
//   - text / thinking chunks  <- `stream_event` content_block_delta — OR, for
//                                an assistant message that streamed NO deltas
//                                (the CLI's non-streaming fallback after a
//                                failed stream), the complete message's text /
//                                thinking blocks replayed as one final chunk
//                                each. Without this the whole reply was lost:
//                                the turn ended clean with nothing persisted.
//   - tool-use-started        <- the complete `assistant` message's
//                                `tool_use` content blocks (full input,
//                                no fragile `input_json_delta` reassembly)
//   - tool-use-completed      <- the `user` message's `tool_result` blocks
//   - usage-reported          <- each `assistant` message's per-request
//                                `message.usage` (the input side = real context
//                                occupancy; the `result` message's usage is
//                                CUMULATIVE across the turn, wrong for occupancy)
//
// The translator is stateless; the runner threads `currentAssistantMessageId`
// (read off `message_start`) so chunk + tool events carry a stable message id,
// and `streamedAssistantMessageIds` (the ids that DID stream deltas) so the
// complete-message replay never doubles text that already streamed.
// See `docs/blueprints/providers/blueprint.md §11.3` + `coding.md §1.2`.

import type {
  NormalizedSessionEvent,
  UsageReportedEvent,
} from '../../shared/normalized-session-event.js'

export type TranslateClaudeSdkEventInput = {
  sdkEvent: unknown
  sessionId: string
  /**
   * The id of the assistant message currently streaming — tracked by the
   * runner across `stream_event` batches (the runner reads it off
   * `message_start`). Used as `messageId` for text/thinking chunks and
   * `parentMessageId` for the `user` message's tool-result events.
   */
  currentAssistantMessageId: string | null
  /**
   * The assistant message ids that streamed at least one text/thinking delta
   * this turn — tracked by the runner. A complete `assistant` message whose
   * id is NOT here replays its text/thinking blocks as final chunks (the
   * non-streaming fallback path); one that is here has already streamed them.
   */
  streamedAssistantMessageIds: ReadonlySet<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The SDK stamps subagent traffic with the spawning Agent tool call's id at
 *  the top level of the message. Non-string (absent/null) = the main thread. */
function readParentToolUseId(message: Record<string, unknown>): string | undefined {
  const value = message['parent_tool_use_id']
  return typeof value === 'string' ? value : undefined
}

export function translateClaudeSdkEvent(
  input: TranslateClaudeSdkEventInput,
): NormalizedSessionEvent[] {
  const { sdkEvent, sessionId, currentAssistantMessageId, streamedAssistantMessageIds } = input
  if (!isRecord(sdkEvent)) {
    return []
  }

  switch (sdkEvent['type']) {
    case 'stream_event':
      return translateStreamEvent(sdkEvent, sessionId, currentAssistantMessageId)
    case 'assistant':
      return translateAssistantMessage(sdkEvent, sessionId, streamedAssistantMessageIds)
    case 'user':
      return translateUserMessage(sdkEvent, sessionId, currentAssistantMessageId)
    default:
      // `result` is handled by the runner (lifecycle) — its usage is cumulative,
      // so it is NOT the occupancy source (see the header note).
      return []
  }
}

// `SDKPartialAssistantMessage` — streamed text + thinking deltas. Tool-use is
// NOT taken from here (it comes from the complete assistant message).
function translateStreamEvent(
  message: Record<string, unknown>,
  sessionId: string,
  messageId: string | null,
): NormalizedSessionEvent[] {
  const event = message['event']
  if (!isRecord(event) || event['type'] !== 'content_block_delta') {
    return []
  }
  const delta = event['delta']
  if (!isRecord(delta)) {
    return []
  }
  const parentToolUseId = readParentToolUseId(message)

  if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
    return [
      {
        kind: 'text-chunk',
        sessionId,
        messageId: messageId ?? '',
        textDelta: delta['text'],
        isFinalChunk: false,
        ...(parentToolUseId !== undefined ? { parentToolUseId } : {}),
      },
    ]
  }
  if (delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
    return [
      {
        kind: 'thinking-chunk',
        sessionId,
        messageId: messageId ?? '',
        textDelta: delta['thinking'],
        isFinalChunk: false,
        ...(parentToolUseId !== undefined ? { parentToolUseId } : {}),
      },
    ]
  }
  return []
}

// `SDKAssistantMessage` — the complete message. Tool-use blocks carry the full
// deserialized `input`; text/thinking blocks are skipped when they already
// streamed — and replayed as final chunks when they did not (see below).
function translateAssistantMessage(
  message: Record<string, unknown>,
  sessionId: string,
  streamedAssistantMessageIds: ReadonlySet<string>,
): NormalizedSessionEvent[] {
  const apiMessage = message['message']
  if (!isRecord(apiMessage) || !Array.isArray(apiMessage['content'])) {
    return []
  }
  const messageId = typeof apiMessage['id'] === 'string' ? apiMessage['id'] : ''
  const parentToolUseId = readParentToolUseId(message)

  const events: NormalizedSessionEvent[] = []
  // The non-streaming fallback: the CLI retries a failed stream as a plain
  // request, so the SDK surfaces this message with NO `stream_event` deltas
  // before it. Its text/thinking exist only here — replay them as one final
  // chunk each, in block order, ahead of the tool calls. MAIN THREAD ONLY: a
  // subagent's deltas are keyed to the main message id (its message_start is
  // deliberately not tracked), so its id is never "streamed" — replaying it
  // would double the Agent card's narrative.
  if (parentToolUseId === undefined && !streamedAssistantMessageIds.has(messageId)) {
    events.push(...replayUnstreamedContentBlocks(apiMessage['content'], sessionId, messageId))
  }
  for (const block of apiMessage['content']) {
    if (!isRecord(block) || block['type'] !== 'tool_use') {
      continue
    }
    if (typeof block['id'] !== 'string' || typeof block['name'] !== 'string') {
      continue
    }
    events.push({
      kind: 'tool-use-started',
      sessionId,
      parentMessageId: messageId,
      toolUseId: block['id'],
      toolName: block['name'],
      toolInput: block['input'],
      startedAt: new Date(),
      ...(parentToolUseId !== undefined ? { parentToolUseId } : {}),
    })
  }

  // Per-request usage rides on the assistant message. The input side
  // (input + cache read + cache creation) is the real context-window occupancy
  // at THIS request; the consumer keeps the last per turn. (The `result`
  // message's usage is cumulative across the turn's tool loop — over-counts on a
  // multi-tool-call turn — so it is no longer the occupancy source.)
  // A SUBAGENT's usage is its OWN context window — reporting it here would let
  // the consumer's keep-the-last rule overwrite the main session's occupancy
  // with the subagent's, corrupting the pressure-swap signal. Skip it.
  const usage = apiMessage['usage']
  if (isRecord(usage) && parentToolUseId === undefined) {
    const usageEvent: UsageReportedEvent = {
      kind: 'usage-reported',
      sessionId,
      messageId,
      inputTokens: typeof usage['input_tokens'] === 'number' ? usage['input_tokens'] : 0,
      outputTokens: typeof usage['output_tokens'] === 'number' ? usage['output_tokens'] : 0,
    }
    if (typeof usage['cache_creation_input_tokens'] === 'number') {
      usageEvent.cacheCreationInputTokens = usage['cache_creation_input_tokens']
    }
    if (typeof usage['cache_read_input_tokens'] === 'number') {
      usageEvent.cacheReadInputTokens = usage['cache_read_input_tokens']
    }
    // The model that ran this request — session-level, but reported on each
    // assistant message. The consumer persists it on the session (denominator).
    if (typeof apiMessage['model'] === 'string') {
      usageEvent.model = apiMessage['model']
    }
    events.push(usageEvent)
  }
  return events
}

/** Text/thinking blocks of a complete assistant message that never streamed,
 *  as final chunks — the persisted-history replay's shape (one block, one
 *  complete chunk). The CLI may surface one API message as several
 *  `assistant` messages (same id, one block each); each replays only the
 *  blocks it carries, so a split message still lands once. */
function replayUnstreamedContentBlocks(
  content: unknown[],
  sessionId: string,
  messageId: string,
): NormalizedSessionEvent[] {
  const events: NormalizedSessionEvent[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block['type'] === 'text' && typeof block['text'] === 'string' && block['text'] !== '') {
      events.push({
        kind: 'text-chunk',
        sessionId,
        messageId,
        textDelta: block['text'],
        isFinalChunk: true,
      })
    } else if (
      block['type'] === 'thinking' &&
      typeof block['thinking'] === 'string' &&
      block['thinking'] !== ''
    ) {
      events.push({
        kind: 'thinking-chunk',
        sessionId,
        messageId,
        textDelta: block['thinking'],
        isFinalChunk: true,
      })
    }
  }
  return events
}

// `SDKUserMessage` — `tool_result` content blocks become tool-use-completed
// events. A plain-string `content` is a normal user message — not translated.
function translateUserMessage(
  message: Record<string, unknown>,
  sessionId: string,
  parentMessageId: string | null,
): NormalizedSessionEvent[] {
  const apiMessage = message['message']
  if (!isRecord(apiMessage) || !Array.isArray(apiMessage['content'])) {
    return []
  }

  const parentToolUseId = readParentToolUseId(message)
  const events: NormalizedSessionEvent[] = []
  for (const block of apiMessage['content']) {
    if (!isRecord(block) || block['type'] !== 'tool_result') {
      continue
    }
    if (typeof block['tool_use_id'] !== 'string') {
      continue
    }
    events.push({
      kind: 'tool-use-completed',
      sessionId,
      parentMessageId: parentMessageId ?? '',
      toolUseId: block['tool_use_id'],
      output: block['content'],
      isError: block['is_error'] === true,
      completedAt: new Date(),
      ...(parentToolUseId !== undefined ? { parentToolUseId } : {}),
    })
  }
  return events
}

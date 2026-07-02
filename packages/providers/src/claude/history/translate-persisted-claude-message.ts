// `translatePersistedClaudeMessage` — the REPLAY translator. Maps ONE record
// from a persisted session JSONL to `NormalizedSessionEvent[]`. Peer to the
// LIVE translator `translate-claude-sdk-event.ts`.
//
// Why a distinct translator: a persisted JSONL holds COMPLETE `assistant`
// messages — there are no `stream_event` deltas to replay. The live
// translator sources text from `stream_event` partials and deliberately
// skips assistant text; replay instead takes text/thinking/tool-use from the
// complete `assistant` content blocks. (See `coding.md §1.2` "every
// translator" + blueprint §11.3.)
//
// Sourcing:
//   - text-chunk         <- complete `assistant` `text` blocks (one chunk each)
//   - thinking-chunk     <- complete `assistant` `thinking` blocks
//   - tool-use-started   <- complete `assistant` `tool_use` blocks
//   - tool-use-completed <- `user` `tool_result` blocks
// Deliberately NOT translated:
//   - usage — every persisted `assistant` line carries `message.usage`;
//     emitting it would yield N usage events the live stream never produces.
//   - session-lifecycle events — runner-owned in the live path; in a replay
//     the transcript's own `startedAt` field carries that information.
//   - `isSidechain: true` records — Task-subagent traffic, not main-thread
//     content.
// PURE + stateless; an unknown shape yields `[]`, never throws.

import type { NormalizedSessionEvent } from '../../shared/normalized-session-event.js'
import type { ClaudeSessionJsonlRecord } from './claude-session-storage.js'

export type TranslatePersistedClaudeMessageInput = {
  jsonlRecord: ClaudeSessionJsonlRecord
  sessionId: string
  /** The id of the most recent main-thread `assistant` message — threaded by
   *  the caller so `user` `tool_result` events carry a stable parent id. */
  currentAssistantMessageId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// The runtime stamps each JSONL record with an ISO `timestamp`; a replayed
// tool event reuses it so the transcript reflects the original session time.
function readRecordTimestamp(record: Record<string, unknown>): Date {
  const rawTimestamp = record['timestamp']
  if (typeof rawTimestamp === 'string') {
    const parsedTimestamp = new Date(rawTimestamp)
    if (!Number.isNaN(parsedTimestamp.getTime())) return parsedTimestamp
  }
  return new Date()
}

export function translatePersistedClaudeMessage(
  input: TranslatePersistedClaudeMessageInput,
): NormalizedSessionEvent[] {
  const { jsonlRecord, sessionId, currentAssistantMessageId } = input

  // Task-subagent traffic shares the JSONL file — not main-thread content.
  if (jsonlRecord['isSidechain'] === true) {
    return []
  }

  switch (jsonlRecord['type']) {
    case 'assistant':
      return translateAssistantRecord(jsonlRecord, sessionId)
    case 'user':
      return translateUserRecord(jsonlRecord, sessionId, currentAssistantMessageId)
    default:
      return [] // summary / file-history-snapshot / system / attachment / ...
  }
}

// A complete `assistant` message — text/thinking/tool-use blocks become the
// corresponding content events. `message.usage` is intentionally ignored.
function translateAssistantRecord(
  record: Record<string, unknown>,
  sessionId: string,
): NormalizedSessionEvent[] {
  const apiMessage = record['message']
  if (!isRecord(apiMessage) || !Array.isArray(apiMessage['content'])) {
    return []
  }
  const messageId = typeof apiMessage['id'] === 'string' ? apiMessage['id'] : ''
  const occurredAt = readRecordTimestamp(record)

  const events: NormalizedSessionEvent[] = []
  for (const block of apiMessage['content']) {
    if (!isRecord(block)) continue

    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      events.push({
        kind: 'text-chunk',
        sessionId,
        messageId,
        textDelta: block['text'],
        isFinalChunk: true, // a persisted block replays as one complete chunk
      })
    } else if (block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
      events.push({
        kind: 'thinking-chunk',
        sessionId,
        messageId,
        textDelta: block['thinking'],
        isFinalChunk: true,
      })
    } else if (
      block['type'] === 'tool_use' &&
      typeof block['id'] === 'string' &&
      typeof block['name'] === 'string'
    ) {
      events.push({
        kind: 'tool-use-started',
        sessionId,
        parentMessageId: messageId,
        toolUseId: block['id'],
        toolName: block['name'],
        toolInput: block['input'],
        startedAt: occurredAt,
      })
    }
  }
  return events
}

// A `user` message — `tool_result` blocks become tool-use-completed events.
// Plain-string content is the user's own prompt, not an assistant event.
function translateUserRecord(
  record: Record<string, unknown>,
  sessionId: string,
  parentMessageId: string | null,
): NormalizedSessionEvent[] {
  const apiMessage = record['message']
  if (!isRecord(apiMessage) || !Array.isArray(apiMessage['content'])) {
    return []
  }
  const occurredAt = readRecordTimestamp(record)

  const events: NormalizedSessionEvent[] = []
  for (const block of apiMessage['content']) {
    if (!isRecord(block) || block['type'] !== 'tool_result') continue
    if (typeof block['tool_use_id'] !== 'string') continue
    events.push({
      kind: 'tool-use-completed',
      sessionId,
      parentMessageId: parentMessageId ?? '',
      toolUseId: block['tool_use_id'],
      output: block['content'],
      isError: block['is_error'] === true,
      completedAt: occurredAt,
    })
  }
  return events
}

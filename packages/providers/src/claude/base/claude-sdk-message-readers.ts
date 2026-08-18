// Pure readers that extract control-flow signals from a raw `SDKMessage`: the
// streamed assistant-message id (needed before text/thinking deltas arrive) and
// a `result` message's early-end error. Stateless — extracted from
// `run-claude-chat-session.ts` to keep that file under the size cap; the runner
// calls these directly. (Thrown-error classification stays in the runner's catch.)

import type { SDKMessage } from './claude-agent-sdk.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// `currentAssistantMessageId` is tracked off a `stream_event`'s `message_start`
// raw event — streamed text/thinking deltas need the id set before they arrive.
// The SDK's raw-event shape is not Vynel's contract; access defensively.
export function readAssistantMessageIdFromStreamStart(sdkMessage: SDKMessage): string | null {
  if (sdkMessage.type !== 'stream_event') return null
  // A SUBAGENT's message_start (forwardSubagentText) must not poison the MAIN
  // session's id tracking — its marked events never read messageId, but the
  // main stream's next deltas would inherit the subagent's id otherwise.
  if (typeof (sdkMessage as { parent_tool_use_id?: unknown }).parent_tool_use_id === 'string') {
    return null
  }
  const rawEvent: unknown = sdkMessage.event
  if (!isRecord(rawEvent) || rawEvent['type'] !== 'message_start') return null
  const startedMessage = rawEvent['message']
  if (isRecord(startedMessage) && typeof startedMessage['id'] === 'string') {
    return startedMessage['id']
  }
  return null
}

// A MAIN-thread text/thinking delta — the runner records the current assistant
// message id as "streamed" on it, so the complete message's translation knows
// its text already arrived (and replays it only when it did not: the CLI's
// non-streaming fallback). Subagent deltas are excluded for the same reason
// their message_start is: they must not mark the main id.
export function isMainThreadContentDelta(sdkMessage: SDKMessage): boolean {
  if (sdkMessage.type !== 'stream_event') return false
  if (typeof (sdkMessage as { parent_tool_use_id?: unknown }).parent_tool_use_id === 'string') {
    return false
  }
  const rawEvent: unknown = sdkMessage.event
  if (!isRecord(rawEvent) || rawEvent['type'] !== 'content_block_delta') return false
  const delta = rawEvent['delta']
  return isRecord(delta) && (delta['type'] === 'text_delta' || delta['type'] === 'thinking_delta')
}

// A `result` message with a non-`success` subtype is an early-ended session;
// the runner — not the translator — owns turning it into `session-errored`.
export function readResultError(
  resultMessage: SDKMessage | null,
): { code: string; message: string } | null {
  if (
    resultMessage === null ||
    resultMessage.type !== 'result' ||
    resultMessage.subtype === 'success'
  ) {
    return null
  }
  const message =
    resultMessage.errors.length > 0
      ? resultMessage.errors.join('; ')
      : `The session ended early (${resultMessage.subtype}).`
  return { code: resultMessage.subtype, message }
}

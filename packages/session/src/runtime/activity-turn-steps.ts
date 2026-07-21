// The ONE mapping from a turn's `ChatTurnEvent` stream to the activity feed's
// narration steps — every turn producer (web/voice SSE, the channel runner,
// schedule fires) taps its event flow through `publishTurnActivityStep` so the
// feed narrates identically no matter which surface drove the turn. Pure and
// colocated with the feed so the vocabulary can't drift per producer.

import type { ChatTurnEvent } from '@vynel/chat'
import type { SessionTurnStep } from '@vynel/contracts/chat/session-activity'
import type { SessionTurnActivityHandle } from './session-activity-feed.js'

// Step labels only need small inputs (an app name, a selector). A large input
// (a file body, a long prompt) is dropped rather than pushed to every listener.
const MAX_TOOL_INPUT_JSON_LENGTH = 2048

function boundedToolInput(toolInput: unknown): { toolInput?: unknown } {
  if (toolInput === undefined) return {}
  try {
    const serialized = JSON.stringify(toolInput)
    if (serialized === undefined || serialized.length > MAX_TOOL_INPUT_JSON_LENGTH) return {}
    return { toolInput }
  } catch {
    // Unserializable input (cycles) — the step still narrates, just unlabeled.
    return {}
  }
}

/** Map one chat event to its feed step — null for everything that isn't one
 *  (text/thinking chunks, session lifecycle, usage). */
export function turnStepFromChatTurnEvent(event: ChatTurnEvent): SessionTurnStep | null {
  switch (event.kind) {
    case 'tool-call-started':
      return {
        kind: 'turn-tool-started',
        toolUseId: event.toolCall.toolUseId,
        toolName: event.toolCall.toolName,
        ...boundedToolInput(event.toolCall.toolInput),
      }
    case 'tool-call-completed': {
      // The completed frame carries the terminal status; 'started' can't occur
      // here, but the type allows it — normalize defensively.
      const status = event.toolCall.status === 'started' ? 'completed' : event.toolCall.status
      return { kind: 'turn-tool-settled', toolUseId: event.toolCall.toolUseId, status }
    }
    case 'approval-requested':
      return {
        kind: 'turn-approval-requested',
        approvalRequestId: event.approvalRequestId,
        toolName: event.toolName,
      }
    case 'approval-resolved':
      return { kind: 'turn-approval-resolved', approvalRequestId: event.approvalRequestId }
    case 'approval-auto-resolved':
      // An auto-resolved card may or may not have been announced — resolving an
      // unannounced id is harmless, missing a resolution leaks a stale card.
      return { kind: 'turn-approval-resolved', approvalRequestId: event.approvalRequestId }
    default:
      return null
  }
}

/** The producer tap — one call next to the existing `sessionResolved` taps. */
export function publishTurnActivityStep(
  handle: SessionTurnActivityHandle,
  event: ChatTurnEvent,
): void {
  const step = turnStepFromChatTurnEvent(event)
  if (step !== null) handle.publishTurnStep(step)
}

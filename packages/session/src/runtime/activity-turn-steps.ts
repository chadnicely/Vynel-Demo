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

// DESKTOP steps get a larger bound because their input IS the surface: the
// overlay reads the approved plan out of `propose_desktop_plan`'s input to know
// Claude is controlling (not merely looking) and to show what was agreed, and
// reads a batched act's `actions` to narrate it. A maximum legal plan is ~6KB
// (goal 500 + 20 steps x 200 + 10 apps x 120), so the general 2KB bound would
// silently blank the safety surface on a big-but-valid plan — the failure would
// read as "Claude is only looking" while an approved plan drives the machine.
// Still bounded: the fan-out protection is about file bodies and long prompts,
// not a few KB a handful of times per turn.
const MAX_DESKTOP_TOOL_INPUT_JSON_LENGTH = 8192

// A SUBAGENT's tool calls normally stay nested under its Agent card and never
// reach the feed — surfacing them all would flood every listener with work the
// manager didn't do. DESKTOP tools are the deliberate exception: the attention
// overlay is a SAFETY surface, and the user must see their machine being driven
// regardless of WHO inside the turn is driving it. Without this a delegated
// desktop task drives the mouse behind a dark overlay.
//
// The prefix is duplicated here rather than imported: `@vynel/desktop-control`
// is a sibling leaf, and leaves never import each other (architecture §2). It
// is load-bearing in the UI fold + presenter too — renaming the server prefix
// means updating all three.
const DESKTOP_TOOL_PREFIX = 'mcp__desktop__'

function isDesktopTool(toolName: string | null): boolean {
  return toolName !== null && toolName.startsWith(DESKTOP_TOOL_PREFIX)
}

function boundedToolInput(toolInput: unknown, toolName: string): { toolInput?: unknown } {
  if (toolInput === undefined) return {}
  const limit = isDesktopTool(toolName)
    ? MAX_DESKTOP_TOOL_INPUT_JSON_LENGTH
    : MAX_TOOL_INPUT_JSON_LENGTH
  try {
    const serialized = JSON.stringify(toolInput)
    if (serialized === undefined || serialized.length > limit) return {}
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
        ...boundedToolInput(event.toolCall.toolInput, event.toolCall.toolName),
      }
    case 'tool-call-completed': {
      // The completed frame carries the terminal status; 'started' can't occur
      // here, but the type allows it — normalize defensively.
      const status = event.toolCall.status === 'started' ? 'completed' : event.toolCall.status
      return { kind: 'turn-tool-settled', toolUseId: event.toolCall.toolUseId, status }
    }
    // Subagent-driven DESKTOP work only — see the prefix note above.
    case 'agent-tool-started':
      return isDesktopTool(event.toolName)
        ? {
            kind: 'turn-tool-started',
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            ...boundedToolInput(event.toolInput, event.toolName),
          }
        : null
    case 'agent-tool-completed':
      return isDesktopTool(event.toolName)
        ? {
            kind: 'turn-tool-settled',
            toolUseId: event.toolUseId,
            status: event.isError ? 'failed' : 'completed',
          }
        : null
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

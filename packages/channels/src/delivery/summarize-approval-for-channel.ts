// Pure formatter — turns an `approval-requested` chat-turn event into the
// channel message body. Uses the REAL event fields `toolName` + `toolInput`
// (there is no `actionKind` on this event — coding.md §10 #11). The 🛡️
// emoji is product message content, not Vynel status-UI (kept — coding.md §1).
//
// Spec: `docs/blueprints/channels/blueprint.md §5.7`.

import type { ChatTurnEvent } from '@vynel/contracts/chat/chat-http'

type ApprovalRequestedEvent = Extract<ChatTurnEvent, { kind: 'approval-requested' }>

const MAX_INPUT_PREVIEW_CHARS = 240

function previewToolInput(toolInput: unknown): string {
  if (toolInput === null || toolInput === undefined) return ''
  let serialized: string
  try {
    serialized = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput)
  } catch {
    return ''
  }
  if (!serialized) return ''
  return serialized.length > MAX_INPUT_PREVIEW_CHARS
    ? `${serialized.slice(0, MAX_INPUT_PREVIEW_CHARS)}…`
    : serialized
}

export function summarizeApprovalForChannel(event: ApprovalRequestedEvent): string {
  const preview = previewToolInput(event.toolInput)
  const detail = preview ? `\n${preview}` : ''
  return (
    `🛡️ Approval needed: ${event.toolName}${detail}\n\n` +
    `Tap a button below, or reply “approve” or “deny <reason>”.`
  )
}

// Pure formatter — turns an approval request into the channel message body.
// Structural param ({ toolName, toolInput }) so BOTH producers fit: the chat-turn
// event and a delegation's normalized approval (there is no `actionKind` on either
// — coding.md §10 #11). The 🛡️ emoji is product message content, not Vynel
// status-UI (kept — coding.md §1).
//
// Spec: `docs/blueprints/channels/blueprint.md §5.7`.

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

export function summarizeApprovalForChannel(event: {
  toolName: string
  toolInput: unknown
  workspaceName?: string
}): string {
  const preview = previewToolInput(event.toolInput)
  const detail = preview ? `\n${preview}` : ''
  const actor = event.workspaceName !== undefined ? ` — in ${event.workspaceName}` : ''
  return (
    `🛡️ Approval needed: ${event.toolName}${actor}${detail}\n\n` +
    `Tap a button below, or reply “approve” or “deny <reason>”.`
  )
}

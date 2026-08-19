// `translateClaudeSystemMessage` — the `system` half of the live translator
// (`translate-claude-sdk-event.ts`, which dispatches here; lifted out for the
// file-size cap). Only the `permission_denied` advisory is content: the SDK's
// OWN safety check (auto-mode classifier, deny rule, mode) refused a tool call
// ahead of `canUseTool`, so no approval ever reached Vynel — the model got a
// canned rejection and stopped. `init`, `compact_boundary` and the status
// frames are the runner's business or nothing. The advisory is best-effort on
// the SDK side ("in rare races a denial can book without a frame"), so it is
// translated as an event of its own rather than folded into the error
// tool_result that always follows. PURE: unknown shapes -> `[]`, never throws.

import type { NormalizedSessionEvent } from '../../shared/normalized-session-event.js'

// Terminal escape sequences the CLI may leave in a decision reason (the SDK
// says so outright: "may carry ANSI escapes; sanitize before rendering").
// The same pattern the process runners strip at capture — duplicated here
// rather than imported: providers is a leaf, and the other copies live in
// sibling leaves (`@vynel/processes`, `@vynel/apps`).
// eslint-disable-next-line no-control-regex -- the escape byte IS what is matched
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b/g

function sanitizeDecisionReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(ANSI_ESCAPE_PATTERN, '').trim()
  return cleaned === '' ? null : cleaned
}

/** `parentToolUseId` is the runner-side subagent attribution the main
 *  translator already reads off the message (non-string = the main thread). */
export function translateClaudeSystemMessage(
  message: Record<string, unknown>,
  sessionId: string,
  parentToolUseId: string | undefined,
): NormalizedSessionEvent[] {
  if (message['subtype'] !== 'permission_denied') {
    return []
  }
  if (
    typeof message['tool_use_id'] !== 'string' ||
    typeof message['tool_name'] !== 'string' ||
    typeof message['message'] !== 'string'
  ) {
    return []
  }
  return [
    {
      kind: 'tool-use-blocked',
      sessionId,
      toolUseId: message['tool_use_id'],
      toolName: message['tool_name'],
      reasonType:
        typeof message['decision_reason_type'] === 'string' ? message['decision_reason_type'] : null,
      reason: sanitizeDecisionReason(message['decision_reason']),
      message: message['message'],
      blockedAt: new Date(),
      ...(parentToolUseId !== undefined ? { parentToolUseId } : {}),
    },
  ]
}

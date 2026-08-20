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

import { stripAnsi } from '@vynel/contracts/text/strip-ansi'
import type { NormalizedSessionEvent } from '../../shared/normalized-session-event.js'

// The SDK says so outright about its decision reasons: "may carry ANSI
// escapes; sanitize before rendering" — this one is rendered in the thread.
function sanitizeDecisionReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = stripAnsi(value).trim()
  return cleaned === '' ? null : cleaned
}

export function translateClaudeSystemMessage(
  message: Record<string, unknown>,
  sessionId: string,
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
  // Subagent attribution rides as `agent_id` here — the SDK never stamps this
  // advisory with the `parent_tool_use_id` the chunk/tool messages carry
  // ("mirrors can_use_tool for host-side routing"), so the consumer can tell a
  // subagent's block apart but cannot key it to an Agent card.
  const agentId = message['agent_id']
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
      ...(typeof agentId === 'string' ? { agentId } : {}),
    },
  ]
}

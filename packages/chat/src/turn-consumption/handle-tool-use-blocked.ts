// Handler for the `tool-use-blocked` variant of the session-event stream — the
// provider's OWN safety check (Claude's auto-mode classifier, a deny rule, the
// mode) refused a tool call ahead of any approval. Extracted from
// `consume-session-event-stream.ts` per structure-standard.md "File size cap"
// (the `handle-usage-reported` precedent).
//
// Why a status of its own: the SDK echoes every such refusal as an error
// tool_result carrying a canned "The user doesn't want to take this action
// right now. STOP…" — persisted as-is the card said "failed" with that cryptic
// line (live incident 2026-08-19, an ssh crontab write). The row instead
// settles `blocked` with the deciding component + its reason as the output, so
// the card can say WHO refused it and offer the one honest recovery: re-issue
// the intent on the same session. The echo that follows must not flip it back
// (the consumer's `blockedToolUseIds` guard — the `wasDenied` twin).
//
// Ordering: the SDK emits the advisory before the echo, but it is best-effort
// on its side ("in rare races a denial can book without a frame"), so both
// orders settle the same — the echo arriving first leaves a `failed` row this
// handler then flips to `blocked`.

import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { NormalizedSessionEvent } from '@vynel/providers'
import { buildBlockedToolOutput } from '@vynel/contracts/chat/blocked-tool-call'
import type { ChatTurnEvent } from '../chat-turn-event.js'
import type { StructuralLogger } from '../chat-types.js'

export type HandleToolUseBlockedInput = {
  db: Database
  event: Extract<NormalizedSessionEvent, { kind: 'tool-use-blocked' }>
  /** The turn's tool_use id -> row id cache (the consumer's per-turn map). */
  toolCallByToolUseId: ReadonlyMap<string, string>
  /** Marked here so the SDK's error echo leaves the row `blocked`. */
  blockedToolUseIds: Set<string>
  logger: StructuralLogger | undefined
}

/** Settles the refused call's row `blocked` and returns the settle frame —
 *  null when there is nothing to settle: a SUBAGENT's block (audited only), or
 *  no row known for the call (logged). */
export function handleToolUseBlocked(input: HandleToolUseBlockedInput): ChatTurnEvent | null {
  const { db, event, toolCallByToolUseId, blockedToolUseIds, logger } = input

  // The audit line — name + deciding component only, never the input (the
  // refused command may be the very thing the user would not want logged).
  logger?.warn(
    {
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      reasonType: event.reasonType,
      ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
    },
    "tool call blocked by the provider's own safety check — the tool never ran",
  )

  // A subagent's refused call has no top-level row — the advisory names the
  // subagent, not the Agent card it runs under, so its lean entry settles off
  // the error echo that follows — and the user cannot re-issue into a subagent
  // anyway. The audit line above is its whole record.
  if (event.agentId !== undefined) return null

  const dbId = toolCallByToolUseId.get(event.toolUseId)
  if (dbId === undefined) {
    logger?.warn(
      { toolUseId: event.toolUseId },
      'tool-use-blocked for unknown toolUseId — dropping',
    )
    return null
  }
  blockedToolUseIds.add(event.toolUseId)
  const updated = chatRepository.updateChatToolCall(db, dbId, {
    status: 'blocked',
    toolOutput: buildBlockedToolOutput({
      reasonType: event.reasonType,
      reason: event.reason,
      message: event.message,
    }),
    isErrorResult: true,
    completedAt: event.blockedAt,
  })
  return updated ? { kind: 'tool-call-completed', toolCall: updated } : null
}

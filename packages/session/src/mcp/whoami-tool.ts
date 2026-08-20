// The `whoami` SDK MCP tool — a session reads its OWN identity: which
// conversation it is (the global assistant, a workspace's main conversation, a
// spawned session, an agent colleague — or a plain conversation), how full its
// context is against the swap threshold, which segment it continues from,
// which duty book teaches its kind (and whether it exists yet), whether it
// still owes a checkpointed next step, and the memory tags that mark what it
// saves as its own. READ-ONLY, no arguments; the answer
// is computed at CALL time from the turn's own context, never from model input
// — a model-visible id could name another session.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { Database } from '@vynel/db'
import { resolveWhoamiReport, type ResolveWhoamiReportInput } from '../runtime/resolve-whoami-report.js'
import type { McpToolFn } from '@vynel/mcp-contract'

const TOOL_DESCRIPTION =
  'Read your OWN identity and state: which conversation you are (the global assistant, a ' +
  'workspace’s main conversation, a spawned session, an agent colleague, or a plain conversation), ' +
  'your primary/segment ids and the segment you continue from, how full your context is (used ' +
  'tokens, the window, the swap threshold and the tokens left before it), your duty book (its id ' +
  'and whether it is published yet — read it with read_playbook when it is), whether you still owe ' +
  'a checkpointed next step that was never continued (pendingCheckpoint: the step and when it was ' +
  'set, else null), and the memory tags to stamp on anything you save to memory so it stays ' +
  'findable as YOURS. READ-ONLY, no arguments. Call it when you need to orient yourself — before ' +
  'saving memories, when planning a long task against your remaining context, or after continuing ' +
  'on a fresh context.'

/** The turn's own identity facts, read at CALL time (the chat id is a getter —
 *  a fresh conversation learns it mid-stream, after its tools are composed). */
export interface WhoamiToolScope {
  userId: string
  primarySessionId?: string
  workspaceId?: string
  resolveChatSessionId?: () => string | undefined
  swapThreshold?: number
}

export function buildWhoamiResponse(
  db: Database,
  scope: WhoamiToolScope,
): { content: Array<{ type: 'text'; text: string }> } {
  const chatSessionId = scope.resolveChatSessionId?.()
  const input: ResolveWhoamiReportInput = {
    userId: scope.userId,
    ...(scope.primarySessionId !== undefined ? { primarySessionId: scope.primarySessionId } : {}),
    ...(scope.workspaceId !== undefined ? { workspaceId: scope.workspaceId } : {}),
    ...(chatSessionId !== undefined ? { chatSessionId } : {}),
    ...(scope.swapThreshold !== undefined ? { swapThreshold: scope.swapThreshold } : {}),
  }
  const report = resolveWhoamiReport(db, input)
  return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] }
}

/** Construct the read-only `whoami` SDK MCP tool. */
export function makeWhoamiTool(db: Database, scope: WhoamiToolScope): unknown {
  return (tool as unknown as McpToolFn)(
    'whoami',
    TOOL_DESCRIPTION,
    {},
    async () => {
      try {
        return buildWhoamiResponse(db, scope)
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true, idempotentHint: true } },
  )
}

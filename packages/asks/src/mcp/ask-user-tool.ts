// The `ask_user` SDK MCP tool — the agent-facing half of the blocking bridge.
// The handler records the pending ask, then PARKS on a promise the waiter
// registry holds; the answer/dismiss routes (or a scope cancel / boot expiry)
// resolve it. There is deliberately NO timeout: a decision Claude chose to
// ask for cannot be fabricated (Chad, module notes fork #1) — the user's
// dismiss is the only "proceed without me" path.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { AskQuestionsSchema, type AskQuestion } from '@vynel/contracts/asks/ask-questions'
import { createAskRequest } from '../lifecycle/create-ask-request.js'
import type { Database } from '@vynel/db'
import type { AskOutcome, StructuralLogger } from '../asks-types.js'
import type { PendingAskRegistry } from '../waiting/pending-ask-registry.js'
import type { McpToolFn } from './mcp-tool-fn.js'

const TOOL_DESCRIPTION =
  'Ask the user for inputs through a friendly form (a step-by-step wizard in the app). Use this ' +
  'ONLY when you are genuinely blocked on their preference or information you cannot find ' +
  'yourself — never for what memory, knowledge, or the conversation already answers. Bundle the ' +
  'related questions you need into ONE call (one form, not five); write labels and options in ' +
  'plain language the user recognizes, never technical jargon. Question types: text / choice / ' +
  'multi-choice / yes-no / number; questions are required unless `required: false`. THIS TOOL ' +
  'WAITS for the user — the turn pauses until they answer. If the result has `answered: false` ' +
  'the user chose not to answer (or the ask was cancelled): proceed as best you can WITHOUT the ' +
  'answer and say what you assumed — do not ask again in the same turn.'

export interface AskUserToolScope {
  userId: string
  workspaceId: string | null // null = a global-root turn
}

export interface AskUserToolDeps {
  waiters: PendingAskRegistry
  // The owning turn's key (minted per stream request) — turn-end cleanup
  // cancels exactly this turn's parked asks, never a sibling turn's.
  turnKey: string
  logger?: StructuralLogger
}

// The bridge itself, SDK-free so it's directly testable: record the pending
// ask, park on the registry, return whatever the outside world resolves.
//
// KNOWN NARROW RACE: if the turn is interrupted after the SDK dispatched the
// tool call but BEFORE this handler ran, the stream's finally cancels first
// and the waiter parked here has no canceller — the row + waiter linger until
// boot expiry. Tolerated: the answer route handles a missing waiter, and boot
// recovery cleans the row.
export async function runAskUserBridge(
  db: Database,
  scope: AskUserToolScope,
  deps: AskUserToolDeps,
  questions: AskQuestion[],
): Promise<AskOutcome> {
  const ask = createAskRequest(
    db,
    { userId: scope.userId, workspaceId: scope.workspaceId, questions },
    deps.logger !== undefined ? { logger: deps.logger } : {},
  )
  return new Promise<AskOutcome>((resolve) => {
    deps.waiters.register({
      askId: ask.id,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      turnKey: deps.turnKey,
      resolve,
    })
  })
}

export function makeAskUserTool(
  db: Database,
  scope: AskUserToolScope,
  deps: AskUserToolDeps,
): unknown {
  return (tool as unknown as McpToolFn)(
    'ask_user',
    TOOL_DESCRIPTION,
    { questions: AskQuestionsSchema },
    async (args) => {
      try {
        const outcome = await runAskUserBridge(db, scope, deps, args.questions as AskQuestion[])
        return { content: [{ type: 'text', text: JSON.stringify(outcome) }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    // Read-only from the WORLD's perspective is wrong (it writes a row), but
    // destructive is wrong too — an ask is reversible plumbing. No annotations.
  )
}

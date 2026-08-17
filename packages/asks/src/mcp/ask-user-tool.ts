// The `ask_user` SDK MCP tool — the agent-facing half of the blocking bridge.
// The handler records the pending ask, then PARKS on a promise the waiter
// registry holds; the answer/dismiss routes (or a scope cancel / boot expiry)
// resolve it.
//
// Timeout policy is the CALLER's: an INTERACTIVE stream passes none — a
// decision Claude chose to ask for cannot be fabricated (Chad, module notes
// fork #1); the user's dismiss is the only "proceed without me" path there.
// An UNATTENDED surface (channel turns) passes `timeoutMs` — nobody may be
// looking at the app, so a bounded wait resolves 'expired' and the turn
// proceeds with judgment instead of parking a background job forever.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { AskQuestionsSchema, type AskQuestion } from '@vynel/contracts/asks/ask-questions'
import { createAskRequest } from '../lifecycle/create-ask-request.js'
import { expireAskRequests } from '../lifecycle/expire-ask-requests.js'
import type { Database } from '@vynel/db'
import type { AskOutcome, StructuralLogger } from '../asks-types.js'
import type { PendingAskRegistry } from '../waiting/pending-ask-registry.js'
import type { McpToolFn } from '@vynel/mcp-contract'

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
  /** The CHAT session whose turn is asking, read at CALL time — stamped on the
   *  ask row so the wizard can point back at the asking conversation AND so
   *  that conversation's status light can say it is waiting on the user.
   *
   *  A getter, not a value: a fresh workspace conversation has no session id
   *  when its tools are composed, so a build-time value was always absent
   *  there and the ask recorded nothing. By the time the model can call this
   *  tool the turn has long since resolved its session. Omitted (or resolving
   *  to undefined) = a turn with no watching conversation; the column is
   *  nullable for exactly that. */
  resolveSessionId?: () => string | undefined
}

export interface AskUserToolDeps {
  waiters: PendingAskRegistry
  // The owning turn's key (minted per stream request) — turn-end cleanup
  // cancels exactly this turn's parked asks, never a sibling turn's.
  turnKey: string
  /** Bounded wait for unattended surfaces — see the file header. Omit on
   *  interactive streams (the recorded no-timeout decision). */
  timeoutMs?: number
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
  // Read the conversation NOW, not when the toolset was composed — see the
  // getter's note on AskUserToolScope.
  const sessionId = scope.resolveSessionId?.()
  const ask = createAskRequest(
    db,
    {
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      questions,
    },
    deps.logger !== undefined ? { logger: deps.logger } : {},
  )
  return new Promise<AskOutcome>((resolve) => {
    let expiryTimer: ReturnType<typeof setTimeout> | undefined
    deps.waiters.register({
      askId: ask.id,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      turnKey: deps.turnKey,
      resolve: (outcome) => {
        if (expiryTimer !== undefined) clearTimeout(expiryTimer)
        resolve(outcome)
      },
    })
    if (deps.timeoutMs !== undefined) {
      expiryTimer = setTimeout(() => {
        // The user may have answered in the same tick — the registry's
        // has-check makes expiry lose that race cleanly.
        if (!deps.waiters.has(ask.id)) return
        try {
          expireAskRequests(
            db,
            { askIds: [ask.id] },
            deps.logger !== undefined ? { logger: deps.logger } : {},
          )
        } catch (err) {
          // A timer callback has no upstream catch — an unguarded throw here
          // is a process crash. A failed row-expire must also never park the
          // turn: resolve anyway; boot expiry sweeps the row later.
          deps.logger?.warn({ err, askId: ask.id }, 'ask expiry bookkeeping failed')
        }
        deps.waiters.resolve(ask.id, { answered: false, reason: 'expired' })
      }, deps.timeoutMs)
      // Never hold the process open for a parked background ask.
      expiryTimer.unref?.()
    }
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

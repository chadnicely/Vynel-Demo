// `drainLeafTurn` — drains a leaf (by-reference) session's normalized event
// stream to completion, capturing the SDK session id (the reference) and
// accumulating the assistant's answer text (the clean result the root absorbs —
// "roots are managers, not doers", gold §5).
//
// Mirrors the `runSeededSwapSession` drain (the stream MUST be consumed to its
// terminal event so the leaf's turn is fully flushed to the runtime's session
// storage — abandoning early can leave the transcript unwritten), but also
// collects `text-chunk` deltas as the result. Throws on a `session-errored`
// terminal event so a failed leaf surfaces up the by-reference call rather than
// returning an empty result.
//
// APPROVAL HANDLING (the C1 fix). A routed leaf is a sub-session with NO user
// watching its stream — its `approval-requested` card cannot be delivered AND
// answered, and the provider's `canUseTool` parks the agent on an unanswerable
// Promise until someone calls `respondToApprovalRequest`. So a routed leaf that
// reaches for a carded (irreversible) tool would DEADLOCK. `drainLeafTurn`
// therefore requires the caller to handle `approval-requested` (fail-closed DENY
// via `buildRoutedLeafApprovalDenier`); if no handler is provided it throws rather
// than hang. Interactive approval for routed sub-sessions is a deferred follow-up
// — until then routing is read-safe-only (see
// `.claude/docs/agent-base/root-session-architecture.md` "Routed-leaf approvals").

import type { AiAgentProvider, NormalizedSessionEvent } from '@vynel/providers'

export type DrainedLeafTurn = {
  /** The leaf's SDK session id — the by-reference handle (D15: also its `chat_sessions.id`). */
  sessionId: string
  /** The assistant's accumulated answer text — the clean result. */
  resultText: string
}

export type DrainLeafTurnOptions = {
  /** Resolves a routed leaf's `approval-requested` (a carded tool). MUST be
   *  provided by the by-reference ops so the leaf fails-closed instead of
   *  deadlocking on the unanswerable `canUseTool` Promise. */
  onApprovalRequested?: (
    event: Extract<NormalizedSessionEvent, { kind: 'approval-requested' }>,
  ) => void | Promise<void>
  /** Circuit-breaker: after this many carded-tool denials in ONE turn, the routed leaf is
   *  interrupted (it kept reaching for irreversible tools past the "report as text" steer) and
   *  the turn ends with a clean write-blocked note — instead of retry-looping to the route
   *  timeout (the owner-reported "stuck on permission" stall). Omit to keep draining
   *  indefinitely (the non-routed callers). Requires `interruptSession`. */
  maxCardedDenials?: number
  /** Interrupt the leaf's session when the denial cap trips — `provider.interruptChatSession`,
   *  which terminates the turn cleanly with a final `session-interrupted` event. */
  interruptSession?: (sessionId: string) => Promise<void>
}

export async function drainLeafTurn(
  stream: AsyncIterable<NormalizedSessionEvent>,
  options: DrainLeafTurnOptions = {},
): Promise<DrainedLeafTurn> {
  let sessionId: string | null = null
  let resultText = ''
  let cardedDenials = 0
  let trippedDenialBreaker = false

  for await (const event of stream) {
    if (event.kind === 'session-started') {
      sessionId = event.sessionId
    } else if (event.kind === 'text-chunk') {
      resultText += event.textDelta
    } else if (event.kind === 'approval-requested') {
      // A routed leaf cannot surface a card to a user — the caller resolves it
      // (fail-closed). No handler = a deadlock waiting to happen → fail loud.
      if (!options.onApprovalRequested) {
        throw new Error(
          `drainLeafTurn: a routed leaf requested approval for "${event.toolName}" but no ` +
            'auto-deny handler was provided — routed leaves must fail-closed, never deadlock.',
        )
      }
      await options.onApprovalRequested(event)
      cardedDenials += 1
      // Circuit-breaker: the leaf keeps reaching for irreversible tools past the deny + "report
      // as text" steer — interrupt it ONCE so it fails fast instead of burning the route timeout.
      if (
        !trippedDenialBreaker &&
        options.maxCardedDenials !== undefined &&
        options.interruptSession !== undefined &&
        sessionId !== null &&
        cardedDenials >= options.maxCardedDenials
      ) {
        trippedDenialBreaker = true
        await options.interruptSession(sessionId)
      }
    } else if (event.kind === 'session-errored') {
      throw new Error(
        `drainLeafTurn: leaf session errored (${event.errorCode}): ${event.errorMessage}`,
      )
    }
  }

  if (sessionId === null) {
    throw new Error('drainLeafTurn: the runtime did not assign a session id for the leaf session')
  }

  // Tripped the breaker → end with a clean write-blocked note, preserving any text the leaf
  // produced before it started flailing (never an empty/partial result the root can't relay).
  if (trippedDenialBreaker) {
    const cleaned = resultText.trim()
    return {
      sessionId,
      resultText:
        cleaned === '' ? ROUTED_LEAF_WRITE_BLOCKED_NOTE : `${cleaned}\n\n${ROUTED_LEAF_WRITE_BLOCKED_NOTE}`,
    }
  }
  return { sessionId, resultText: resultText.trim() }
}

// The reason shown to a routed agent when it reaches for an irreversible tool. It
// steers the model to report its findings as text rather than retry-loop the denied
// tool (which would burn the route timeout). Interactive approval for routed
// sub-sessions is deferred.
export const ROUTED_LEAF_APPROVAL_DENY_REASON =
  'Irreversible actions are not available to a routed agent. Report what you found ' +
  'as text instead; do not retry this tool.'

// How many carded-tool denials a routed turn tolerates before the breaker interrupts it. The
// first denial lets a COMPLIANT model report as text (no second denial → no trip); a model that
// retries past the steer trips it on the second, so it fails in ~2 round-trips, not the timeout.
export const ROUTED_LEAF_MAX_CARDED_DENIALS = 2

// The clean result returned when the breaker trips — relayed by the root so the user learns the
// routed task couldn't write (and how to make it work) instead of a silent stall.
export const ROUTED_LEAF_WRITE_BLOCKED_NOTE =
  "I couldn't finish this in the background — a routed task can't perform writes, edits, or " +
  'other irreversible actions yet, and it kept trying. Open this workspace and re-run it in the ' +
  'conversation, where you can approve those actions.'

// Builds the fail-closed `onApprovalRequested` handler bound to a provider. BOTH
// `createLeafSession` (create) and `pushToSession` (resume) drain through this
// path, so both must fail-closed identically. The provider is a singleton (via
// `resolveAiAgentProvider`), so `respondToApprovalRequest` resolves the SAME
// registry that registered the leaf's pending approval.
export function buildRoutedLeafApprovalDenier(
  provider: Pick<AiAgentProvider, 'respondToApprovalRequest'>,
): NonNullable<DrainLeafTurnOptions['onApprovalRequested']> {
  return (event) =>
    provider.respondToApprovalRequest(event.approvalRequestId, {
      kind: 'denied',
      reason: ROUTED_LEAF_APPROVAL_DENY_REASON,
    })
}

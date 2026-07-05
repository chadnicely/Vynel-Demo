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
// APPROVAL HANDLING (the C1 fix + surface-up). A routed leaf is a sub-session
// whose stream no user watches, and the provider's `canUseTool` parks the agent
// on a Promise until someone calls `respondToApprovalRequest`. `drainLeafTurn`
// therefore requires the caller to handle `approval-requested`; with no handler
// it throws rather than hang. The handler decides the policy:
//   - fail-closed DENY (`buildRoutedLeafApprovalDenier`) — the leaf-agent path;
//   - RECORD-AND-PARK (surface-up) — record the approval so the user decides
//     from the web notifier / origin channel and return WITHOUT responding; the
//     provider stays parked and the drain simply keeps consuming until the
//     decision arrives (`resolveApproval` → `respondToApprovalRequest`) and the
//     turn resumes. The unanswered bound is the approvals reaper.
// Either way the DENIAL circuit-breaker below counts `approval-resolved` events
// with a denied decision — after `maxCardedDenials` in one turn the leaf is
// interrupted (it kept proposing irreversible actions past the denials) instead
// of retry-looping the route budget away.

import type { AiAgentProvider, NormalizedSessionEvent } from '@vynel/providers'

export type DrainedLeafTurn = {
  /** The leaf's SDK session id — the by-reference handle (D15: also its `chat_sessions.id`). */
  sessionId: string
  /** The assistant's accumulated answer text — the clean result. */
  resultText: string
}

export type DrainLeafTurnOptions = {
  /** Handles a routed leaf's `approval-requested` (a carded tool). MUST be provided
   *  by the by-reference ops — either deny fail-closed (`buildRoutedLeafApprovalDenier`)
   *  or record-and-park (surface-up: record, don't respond; the provider stays parked
   *  until the user's decision unblocks it). Without a handler the drain throws
   *  instead of silently deadlocking. */
  onApprovalRequested?: (
    event: Extract<NormalizedSessionEvent, { kind: 'approval-requested' }>,
  ) => void | Promise<void>
  /** Observes each `approval-resolved` (the provider emits one for every decision —
   *  auto-deny, user decision, or reaper timeout). The surface-up composition uses it
   *  to resume the suspended wait budget for a parked approval. */
  onApprovalResolved?: (
    event: Extract<NormalizedSessionEvent, { kind: 'approval-resolved' }>,
  ) => void | Promise<void>
  /** Circuit-breaker: after this many DENIED approvals in ONE turn, the routed leaf is
   *  interrupted (it kept proposing irreversible actions past the denials) and the turn
   *  ends with a clean blocked note — instead of retry-looping to the route timeout (the
   *  owner-reported "stuck on permission" stall). Omit to keep draining indefinitely
   *  (the non-routed callers). Requires `interruptSession`. */
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
      // A routed leaf cannot surface an inline card — the caller decides the policy
      // (deny fail-closed, or record-and-park). No handler = a deadlock waiting to
      // happen → fail loud.
      if (!options.onApprovalRequested) {
        throw new Error(
          `drainLeafTurn: a routed leaf requested approval for "${event.toolName}" but no ` +
            'approval handler was provided — routed leaves must fail-closed, never deadlock.',
        )
      }
      await options.onApprovalRequested(event)
    } else if (event.kind === 'approval-resolved') {
      await options.onApprovalResolved?.(event)
      // Circuit-breaker on DENIALS (auto-deny, user, or reaper): the leaf keeps proposing
      // irreversible actions past the denials — interrupt it ONCE so it fails fast
      // instead of burning the route timeout. Approvals never count toward the trip.
      if (event.decision.kind === 'denied') {
        cardedDenials += 1
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

// The reason shown to a leaf agent when its carded tool is auto-denied (the
// fail-closed leaf-agent path — routed WORKSPACE turns now surface-up instead).
// It steers the model to report its findings as text rather than retry-loop the
// denied tool (which would burn the route timeout).
export const ROUTED_LEAF_APPROVAL_DENY_REASON =
  'Irreversible actions are not available to a routed agent. Report what you found ' +
  'as text instead; do not retry this tool.'

// How many DENIED approvals a routed turn tolerates before the breaker interrupts it. The
// first denial lets a COMPLIANT model report as text (no second denial → no trip); a model
// that keeps proposing denied actions trips it on the second, so it fails in ~2 round-trips,
// not the timeout.
export const ROUTED_LEAF_MAX_CARDED_DENIALS = 2

// The clean result returned when the breaker trips — relayed by the root so the user learns
// why the routed task stopped (their denials, or the fail-closed auto-deny) instead of a
// silent stall.
export const ROUTED_LEAF_WRITE_BLOCKED_NOTE =
  "I couldn't finish this in the background — the irreversible actions I proposed were " +
  "denied. I've reported what I could do without them; open this workspace's conversation " +
  'to run the rest interactively.'

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

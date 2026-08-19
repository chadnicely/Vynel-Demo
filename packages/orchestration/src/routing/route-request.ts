// `routeRequest` — the request-down / report-up coordinator for LLM-native routing
// (agent-base Slice 4). On a global-root turn the global-root model decides WHERE to
// route by calling the routing MCP tool; that tool invokes this coordinator. It
// delegates the task DOWN to the injected target and reports the result UP as a thin
// envelope (status + distilled result). The `delegate` dep is INJECTED — the
// `bridgePrimarySession` dependency-injection precedent keeps this op pure +
// unit-testable, with no `@vynel/db` / `@vynel/providers` import.
//
// Delegation target (brain-tree Phase 1): the injected `delegate` routes into the
// target workspace's CONTINUING ROOT brain (`delegateToWorkspaceRoot`) — the
// workspace's own conversation, with its context — NOT a fresh throwaway agent. The
// agent ("hand") layer returns UNDER the workspace root in Phase 3 (the locked
// 3-level hierarchy). The target runs through `startChatSession`, so the safety
// backstop still cards its tools (surface-up: a carded tool parks for the user's
// decision; the fail-closed deny remains the un-injected fallback).
//
// THE ENVELOPE SETTLES ONLY WHEN THE DELEGATE SETTLES (session-hardening arc,
// 2026-08-19). The old shape raced the delegate against a "stop waiting" budget
// and returned a `timed-out` envelope while the routed turn kept running — the
// tick then released the target's single-writer lock under a live turn, and the
// next claim resumed the SAME SDK session concurrently (audit L1, reproduced by
// three agents). The bound is now a HARD CAP on the turn itself: when it fires,
// `deps.onHardCap` runs ONCE (the caller cancels the turn — the cancel registry /
// Stop path interrupts its SDK session) and this coordinator keeps awaiting the
// delegate; whatever the delegate then settles to, the envelope reads `capped`
// with an honest message. The target lock, held for the coordinator's lifetime,
// therefore covers the WHOLE run.
//
// SURFACE-UP (decision C): while a routed approval is PARKED on a human decision
// the cap clock SUSPENDS (via the optional `waitGate`) — the cap measures the
// target's working time, not the human's deciding time. The unanswered bound
// is the approvals reaper, which denies a stale card and resumes the clock.

import type { StructuralLogger } from '../orchestration-types.js'
import type { ApprovalWaitGate } from './approval-wait-gate.js'
import { startPausableTimeout } from './pausable-timeout.js'

/** The hard cap on one routed turn's working time when the caller names none —
 *  60 minutes, the same value `VYNEL_DELEGATED_TURN_MAX_MS` defaults to (D5). */
export const DEFAULT_ROUTE_HARD_CAP_MS = 60 * 60 * 1000

export type RouteRequestInput = {
  userId: string
  /** The delegating (parent) session — the global root's current SDK session id. */
  parentSessionId: string
  /** The workspace the task is routed to. */
  targetWorkspaceId: string
  /** The target workspace folder — the routed turn's cwd. */
  targetWorkspacePath: string
  /** The task to route down — the workspace root's message. */
  taskText: string
  /** The hard cap on the routed turn's WORKING time (ms; suspended while the
   *  wait gate is parked). Defaults to DEFAULT_ROUTE_HARD_CAP_MS. */
  hardCapMs?: number
}

export type RouteRequestResult =
  | { status: 'completed'; reference: string; result: string }
  /** The cap fired, the turn was cancelled and has since SETTLED — the run is
   *  over, whatever the delegate produced. `message` is the row-ready reason. */
  | { status: 'capped'; hardCapMs: number; message: string }
  | { status: 'failed'; message: string }

/** The injected delegation (apps/api binds `delegateToWorkspaceRoot`). The binder
 *  adds the target-specific args it captures (the workspace name, the provider id). */
export type DelegateForRouting = (input: {
  parentSessionId: string
  userId: string
  workspaceId: string
  workspacePath: string
  taskText: string
}) => Promise<{ reference: string; resultText: string }>

export type RouteRequestDeps = {
  delegate: DelegateForRouting
  logger?: StructuralLogger
  /** When given, the cap clock SUSPENDS while the gate reports a parked approval
   *  (surface-up decision C) and resumes with the remaining budget on resolve. */
  waitGate?: ApprovalWaitGate
  /** Fires ONCE when the cap is spent: cancel the routed turn (interrupt its SDK
   *  session). The coordinator keeps awaiting the delegate — cancelling is the
   *  caller's lever, settling is the turn's. A throw here is logged, never
   *  propagated (the delegate still settles on its own). */
  onHardCap?: () => void | Promise<void>
}

/** "exceeded the 60-minute cap" — minutes when the cap is one, raw ms below that
 *  (test-sized caps must not read as "0-minute"). */
export function describeHardCap(hardCapMs: number): string {
  return hardCapMs >= 60_000 ? `${Math.round(hardCapMs / 60_000)}-minute` : `${hardCapMs}ms`
}

export async function routeRequest(
  input: RouteRequestInput,
  deps: RouteRequestDeps,
): Promise<RouteRequestResult> {
  const hardCapMs = input.hardCapMs ?? DEFAULT_ROUTE_HARD_CAP_MS

  let settled = false
  let capFired = false
  const cap = startPausableTimeout(hardCapMs, deps.waitGate)
  // Detached on purpose: the cap's only job is to pull the cancel lever; the
  // await below stays on the delegate alone. A cap that fires in the same tick
  // the delegate settles must not cancel a turn that is already over.
  void cap.promise.then(async () => {
    if (settled) return
    capFired = true
    deps.logger?.warn(
      { targetWorkspaceId: input.targetWorkspaceId, hardCapMs },
      'routeRequest: the routed turn exceeded its hard cap — cancelling it and awaiting its end',
    )
    try {
      await deps.onHardCap?.()
    } catch (error: unknown) {
      deps.logger?.warn(
        { targetWorkspaceId: input.targetWorkspaceId, error: String(error) },
        'routeRequest: the hard-cap cancel lever threw (the turn still settles on its own)',
      )
    }
  })

  // The delegation promise NEVER rejects — failures convert to a `failed` envelope.
  const outcome: RouteRequestResult = await deps
    .delegate({
      parentSessionId: input.parentSessionId,
      userId: input.userId,
      workspaceId: input.targetWorkspaceId,
      workspacePath: input.targetWorkspacePath,
      taskText: input.taskText,
    })
    .then(
      (delegated): RouteRequestResult => ({
        status: 'completed',
        reference: delegated.reference,
        result: delegated.resultText,
      }),
    )
    .catch(
      (error: unknown): RouteRequestResult => ({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  settled = true
  cap.cancel()

  if (capFired) {
    // The turn ran past the cap and was cancelled; how it then settled (a
    // clean interrupt throw, a partial completion that outran the interrupt)
    // is bookkeeping — the honest outcome is the cap.
    deps.logger?.warn(
      { targetWorkspaceId: input.targetWorkspaceId, hardCapMs, settledAs: outcome.status },
      'routeRequest: the capped turn settled',
    )
    return { status: 'capped', hardCapMs, message: `exceeded the ${describeHardCap(hardCapMs)} cap` }
  }
  if (outcome.status === 'failed') {
    deps.logger?.warn(
      { targetWorkspaceId: input.targetWorkspaceId, message: outcome.message },
      'routeRequest: routed delegation failed',
    )
  }
  return outcome
}

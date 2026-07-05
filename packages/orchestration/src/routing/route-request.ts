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
// The timeout is "stop WAITING", NOT "stop the target": on timeout we return a
// timed-out envelope, but the routed turn keeps running in its own SDK session.
// The result is not surfaced after the timeout (a deferred follow-up); the
// up-report says only that the workspace is still working.
//
// SURFACE-UP (decision C): while a routed approval is PARKED on a human decision
// the wait clock SUSPENDS (via the optional `waitGate`) — the budget measures the
// workspace's working time, not the human's deciding time. The unanswered bound
// is the approvals reaper, which denies a stale card and resumes the clock.

import type { StructuralLogger } from '../orchestration-types.js'
import type { ApprovalWaitGate } from './approval-wait-gate.js'

/** Conservative per-sub-session wait budget — bounds a routed leaf's turn. */
export const DEFAULT_ROUTE_TIMEOUT_MS = 120_000

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
  /** Per-sub-session wait budget (ms). Defaults to DEFAULT_ROUTE_TIMEOUT_MS. */
  timeoutMs?: number
}

export type RouteRequestResult =
  | { status: 'completed'; reference: string; result: string }
  | { status: 'timed-out'; timeoutMs: number }
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
  /** When given, the wait clock SUSPENDS while the gate reports a parked approval
   *  (surface-up decision C) and resumes with the remaining budget on resolve. */
  waitGate?: ApprovalWaitGate
}

/** A timeout that can pause (keeping its remaining budget) and resume — the
 *  suspend-while-parked wait clock. Returns the racing promise + a cancel. */
function startPausableTimeout(
  timeoutMs: number,
  waitGate: ApprovalWaitGate | undefined,
): { promise: Promise<RouteRequestResult>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined
  let remainingMs = timeoutMs
  let armedAt: number | null = null
  let cancelled = false

  const promise = new Promise<RouteRequestResult>((resolve) => {
    const arm = (): void => {
      if (cancelled) return
      armedAt = Date.now()
      handle = setTimeout(() => resolve({ status: 'timed-out', timeoutMs }), remainingMs)
    }
    const disarm = (): void => {
      if (handle !== undefined) clearTimeout(handle)
      handle = undefined
      if (armedAt !== null) remainingMs = Math.max(0, remainingMs - (Date.now() - armedAt))
      armedAt = null
    }
    waitGate?.onParkedChange((parked) => (parked ? disarm() : arm()))
    if (!waitGate?.isParked) arm()
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      if (handle !== undefined) clearTimeout(handle)
    },
  }
}

export async function routeRequest(
  input: RouteRequestInput,
  deps: RouteRequestDeps,
): Promise<RouteRequestResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS

  const wait = startPausableTimeout(timeoutMs, deps.waitGate)

  // The delegation promise NEVER rejects — failures convert to a `failed` envelope
  // here, so a post-timeout rejection can't surface as an unhandled rejection.
  const delegationPromise: Promise<RouteRequestResult> = deps
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

  const outcome = await Promise.race([delegationPromise, wait.promise])
  wait.cancel()

  if (outcome.status === 'timed-out') {
    deps.logger?.warn(
      { targetWorkspaceId: input.targetWorkspaceId, timeoutMs },
      'routeRequest: timed out waiting for the workspace root (it keeps running in its own session)',
    )
  } else if (outcome.status === 'failed') {
    deps.logger?.warn(
      { targetWorkspaceId: input.targetWorkspaceId, message: outcome.message },
      'routeRequest: routed delegation failed',
    )
  }
  return outcome
}

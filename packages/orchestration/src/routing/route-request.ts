// `routeRequest` — the request-down / report-up coordinator for LLM-native routing
// (agent-base Slice 4). On a global-root turn the global-root model decides WHERE to
// route by calling the routing MCP tool; that tool invokes this coordinator. It
// delegates the task DOWN to the injected target and reports the result UP as a thin
// envelope (status + distilled result). The `delegate` dep is INJECTED — the
// `bridgeRootSession` dependency-injection precedent keeps this op pure +
// unit-testable, with no `@vynel/db` / `@vynel/providers` import.
//
// Delegation target (brain-tree Phase 1): the injected `delegate` routes into the
// target workspace's CONTINUING ROOT brain (`delegateToWorkspaceRoot`) — the
// workspace's own conversation, with its context — NOT a fresh throwaway agent. The
// agent ("hand") layer returns UNDER the workspace root in Phase 3 (the locked
// 3-level hierarchy). The target runs through `startChatSession`, so the safety
// backstop still cards its tools (read-safe: a routed turn fails closed).
//
// The timeout is "stop WAITING", NOT "stop the target": on timeout we return a
// timed-out envelope, but the routed turn keeps running in its own SDK session. It
// no longer DEADLOCKS on a carded tool — a routed turn fails-closed-denies
// irreversible tools (see `drainLeafTurn`), so a timeout means genuinely-long work,
// not a hang. The result is not surfaced after the timeout (a deferred follow-up);
// the up-report says only that the workspace is still working.

import type { StructuralLogger } from '../orchestration-types.js'

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
}

export async function routeRequest(
  input: RouteRequestInput,
  deps: RouteRequestDeps,
): Promise<RouteRequestResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<RouteRequestResult>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ status: 'timed-out', timeoutMs }), timeoutMs)
  })

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

  const outcome = await Promise.race([delegationPromise, timeoutPromise])
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)

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

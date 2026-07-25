// The internal side-channel carrying the RUNNING turn's chain key, so a hop made
// from inside a delegated turn CONTINUES its thread instead of starting a new one.
//
// Without it, `threadId` would only ever be self-seeded: every enqueue from
// inside a routed turn (a workspace re-delegating, a child reporting up) would
// begin a fresh chain and the column would tell us nothing `partialSessionId`
// didn't already.
//
// Why a header, not a tool input: the chain key is AMBIENT turn context the model
// never sees — same reasoning as `DELEGATION_ORIGIN_HEADER`,
// `DELEGATION_MODE_HEADER` and `REPORT_CALLER_HEADER`, whose dispatcher wrapping
// this mirrors exactly. A model-visible thread id could be mis-set, which would
// silently splice one task's chain onto another's. Internal; never part of the
// OpenAPI contract.

import type { HonoAppRequestFn } from '../factory.js'

export const DELEGATION_THREAD_HEADER = 'x-vynel-delegation-thread'

/** Parse at the route boundary — defensively. An absent or blank value yields
 *  `undefined`, i.e. "this hop starts a chain", which is the correct reading for
 *  every turn that is not itself part of one (interactive chats, schedule fires,
 *  the global root's own first delegation). */
export function parseDelegationThreadHeader(headerValue: string | undefined): string | undefined {
  const trimmed = headerValue?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** Wrap the in-process dispatcher so every request a routed turn's MCP tools make
 *  carries the chain key (the `wrapAppRequestWithReportCaller` shape). */
export function wrapAppRequestWithDelegationThread(
  appRequest: HonoAppRequestFn,
  threadId: string,
): HonoAppRequestFn {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set(DELEGATION_THREAD_HEADER, threadId)
    return appRequest(input, { ...init, headers })
  }
}

// The internal side-channel carrying the RUNNING job's id, so a turn that
// reports through the tool can mark its own queue row.
//
// WHY IT EXISTS: the tick auto-reports a completed turn's reply. Without a way
// to know an explicit report already happened, a turn that used the tool would
// ALSO have its chat reply harvested and sent — waking the requester twice with
// overlapping content. The route stamps the row; the tick reads it.
//
// Why a header, not a tool input: same reasoning as its three siblings (origin,
// mode, thread). The job id is ambient turn context the model never sees; a
// model-visible one could be mis-set and would mark the WRONG row reported,
// silently suppressing a real report. Internal; never in the OpenAPI contract.

import type { HonoAppRequestFn } from '../factory.js'

export const DELEGATION_JOB_HEADER = 'x-vynel-delegation-job'

/** Parse at the route boundary — defensively. Absent means "not a delegated
 *  turn" (interactive chats, schedule fires, the global root), which is the
 *  correct reading: there is no queue row to mark. */
export function parseDelegationJobHeader(headerValue: string | undefined): string | undefined {
  const trimmed = headerValue?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** Wrap the in-process dispatcher so every request this turn's tools make
 *  carries the job id (the `wrapAppRequestWithReportCaller` shape). */
export function wrapAppRequestWithDelegationJob(
  appRequest: HonoAppRequestFn,
  jobId: string,
): HonoAppRequestFn {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set(DELEGATION_JOB_HEADER, jobId)
    return appRequest(input, { ...init, headers })
  }
}

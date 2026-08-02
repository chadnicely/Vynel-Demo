// The internal side-channel carrying a BACKGROUND turn's REQUESTER OVERRIDE
// (chat-mentions): the ORIGINATING chat's workspace id. Without it a
// workspace-primary caller always reports to the global root (the tree's top)
// — but a `@persona` mention typed in ANOTHER workspace's chat must report
// back to THAT chat. The delegated-turn MCP composer stamps this from the
// job's `requesterWorkspaceId`; `POST /routing/report` reads it and addresses
// the delivery to that workspace's primary instead.
//
// Why a header (the report-caller-header shape, verbatim): the requester is
// AMBIENT turn context the model never sees — a model-visible field could be
// mis-set and a mis-addressed report is unrecoverable once enqueued.
// Server-stamped per turn at compose time, it cannot lie. Internal + never
// part of the OpenAPI contract. Absent = the standing topology (a workspace
// primary reports to the global root), byte-for-byte.

import type { HonoAppRequestFn } from '../factory.js'

export const REPORT_REQUESTER_HEADER = 'x-vynel-report-requester'

/** Parse the override at the route boundary — defensively (absent/blank =
 *  no override; the value is a workspace id, ownership-checked by the route). */
export function parseReportRequesterHeader(headerValue: string | undefined): string | undefined {
  if (headerValue === undefined || headerValue.trim() === '') return undefined
  return headerValue
}

/** Wrap the in-process dispatcher so every request a routed turn's MCP tools
 *  make carries the originating chat's workspace id (the report-caller shape). */
export function wrapAppRequestWithReportRequester(
  appRequest: HonoAppRequestFn,
  requesterWorkspaceId: string,
): HonoAppRequestFn {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set(REPORT_REQUESTER_HEADER, requesterWorkspaceId)
    return appRequest(input, { ...init, headers })
  }
}

// The internal side-channel carrying a BACKGROUND turn's CALLER IDENTITY from the
// delegated-turn MCP composer to the `POST /routing/report` route (session-comms,
// the revert flow). `buildDelegatedTurnMcpComposer` wraps each routed turn's app
// dispatcher to set this header; the report route reads it to resolve WHO is
// reporting — and therefore who the requester is (a spawned session reports to its
// creator; a workspace primary reports to the global root).
//
// Why a header (not a tool input): the caller identity is AMBIENT turn context the
// model never sees — a model-visible field could be mis-set and would mis-address
// the report (the notes' fork 2: "no session ids in the tool input = no
// mis-addressing"). Server-stamped per turn at compose time, it CANNOT lie.
// Internal + never part of the OpenAPI contract (the delegation-origin-header
// precedent). A turn without the header (interactive chats, schedule fires, the
// global root) simply has no requester — the route 400s with an actionable note.

import type { HonoAppRequestFn } from '../factory.js'

export const REPORT_CALLER_HEADER = 'x-vynel-report-caller'

/** Who is running the current background turn — the report's "from" side. */
export type ReportCaller =
  | { kind: 'workspace-primary'; workspaceId: string }
  | { kind: 'spawned-session'; targetPrimarySessionId: string }

export function serializeReportCaller(caller: ReportCaller): string {
  return JSON.stringify(caller)
}

/** Parse the caller header at the route boundary — defensively (a malformed or
 *  absent header yields `undefined`: no caller identity, no requester). */
export function parseReportCallerHeader(headerValue: string | undefined): ReportCaller | undefined {
  if (headerValue === undefined || headerValue === '') return undefined
  try {
    const parsed = JSON.parse(headerValue) as Partial<{
      kind: string
      workspaceId: string
      targetPrimarySessionId: string
    }>
    if (parsed.kind === 'workspace-primary' && typeof parsed.workspaceId === 'string') {
      return { kind: 'workspace-primary', workspaceId: parsed.workspaceId }
    }
    if (parsed.kind === 'spawned-session' && typeof parsed.targetPrimarySessionId === 'string') {
      return { kind: 'spawned-session', targetPrimarySessionId: parsed.targetPrimarySessionId }
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Wrap the in-process dispatcher so every request a routed turn's MCP tools make
 *  carries the caller identity (the `wrapAppRequestWithOrigin` shape). */
export function wrapAppRequestWithReportCaller(
  appRequest: HonoAppRequestFn,
  caller: ReportCaller,
): HonoAppRequestFn {
  const headerValue = serializeReportCaller(caller)
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set(REPORT_CALLER_HEADER, headerValue)
    return appRequest(input, { ...init, headers })
  }
}

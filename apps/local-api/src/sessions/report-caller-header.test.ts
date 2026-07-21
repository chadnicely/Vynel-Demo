// Unit tests for the report-caller header codec (session-comms) — round-trip for both
// caller kinds, the defensive boundary parse (a malformed/absent header = no caller,
// never a throw), and the dispatcher wrapper stamping the header on every request.

import { describe, expect, it } from 'vitest'
import {
  serializeReportCaller,
  parseReportCallerHeader,
  wrapAppRequestWithReportCaller,
  REPORT_CALLER_HEADER,
} from './report-caller-header.js'
import type { HonoAppRequestFn } from '../factory.js'

describe('report-caller-header', () => {
  it('round-trips both caller kinds', () => {
    const workspace = { kind: 'workspace-primary' as const, workspaceId: 'ws-1' }
    expect(parseReportCallerHeader(serializeReportCaller(workspace))).toEqual(workspace)
    const spawned = { kind: 'spawned-session' as const, targetPrimarySessionId: 'sp-1' }
    expect(parseReportCallerHeader(serializeReportCaller(spawned))).toEqual(spawned)
  })

  it('returns undefined for an absent or empty header (no caller, no requester)', () => {
    expect(parseReportCallerHeader(undefined)).toBeUndefined()
    expect(parseReportCallerHeader('')).toBeUndefined()
  })

  it('returns undefined for malformed JSON or a mistyped/unknown shape instead of throwing', () => {
    expect(parseReportCallerHeader('{not json')).toBeUndefined()
    expect(parseReportCallerHeader('{"kind":"workspace-primary"}')).toBeUndefined()
    expect(parseReportCallerHeader('{"kind":"spawned-session","targetPrimarySessionId":7}')).toBeUndefined()
    expect(parseReportCallerHeader('{"kind":"global-root"}')).toBeUndefined()
  })

  it('wrapAppRequestWithReportCaller stamps the header on every dispatched request', async () => {
    const seenHeaders: Array<string | null> = []
    const appRequest: HonoAppRequestFn = (async (_input: unknown, init?: RequestInit) => {
      seenHeaders.push(new Headers(init?.headers).get(REPORT_CALLER_HEADER))
      return new Response('{}')
    }) as HonoAppRequestFn
    const wrapped = wrapAppRequestWithReportCaller(appRequest, {
      kind: 'spawned-session',
      targetPrimarySessionId: 'sp-9',
    })
    await wrapped('/routing/report', { method: 'POST' })
    await wrapped('/anything/else')
    expect(seenHeaders).toHaveLength(2)
    for (const headerValue of seenHeaders) {
      expect(parseReportCallerHeader(headerValue ?? undefined)).toEqual({
        kind: 'spawned-session',
        targetPrimarySessionId: 'sp-9',
      })
    }
  })
})

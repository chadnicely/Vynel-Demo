// Unit test for the global-root turn wrapper. The shared core
// (`runGlobalRootTurnCore`) is mocked so we drive the DRAIN sink directly and
// assert its contract: accumulate text chunks, capture the session id, and throw
// (via `requireResult`) when the turn produced no session or captured an in-stream
// error. `@vynel/mcp` is stubbed so the REAL composer runs with a `build → null`
// routing descriptor — the phase-now routing-toolless global root (empty MCP set) —
// without pulling the SDK.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { SessionActivityFeed, SessionSink } from '@vynel/session/runtime'

const { coreMock } = vi.hoisted(() => ({ coreMock: vi.fn() }))

vi.mock('@vynel/session/runtime', async () => {
  // The REAL step mapper runs (it's pure) so the drain sink's feed-narration
  // tap is exercised, while the heavy core stays mocked.
  const actual =
    await vi.importActual<typeof import('@vynel/session/runtime')>('@vynel/session/runtime')
  return { runGlobalRootTurnCore: coreMock, publishTurnActivityStep: actual.publishTurnActivityStep }
})

// Stub routing descriptor: `build` returns null → the real `composeSessionMcpServers`
// yields an empty MCP set, and the heavy `@vynel/mcp` (SDK builder) never loads.
vi.mock('@vynel/mcp', () => ({
  vynelRoutingDescriptor: { serverName: 'vynel', build: () => null },
}))
// Same treatment for the notebook descriptor (instructions slice) — a null
// build keeps the SDK out and the composed MCP set empty.
vi.mock('@vynel/instructions', () => ({
  notebookFeatureDescriptor: { serverName: 'vynel-notebook', build: () => null },
}))
// The runner composes user-scope agents against the real db — these tests
// drive a stub `{}` db, so the composition (and its lifecycle records, which
// only fire when agents exist) is stubbed empty.
vi.mock('@vynel/orchestration', async () => {
  const actual = await vi.importActual<typeof import('@vynel/orchestration')>('@vynel/orchestration')
  return { ...actual, composeSessionAgents: async () => ({}) }
})

import {
  runGlobalRootTurn,
  wrapAppRequestWithOrigin,
  buildGlobalRootReportTurnRunner,
} from './run-global-root-turn.js'
import { REPORT_DELIVERY_INSTRUCTIONS } from '@vynel/session/delegation'
import { DELEGATION_ORIGIN_HEADER, serializeDelegationOrigin } from './delegation-origin-header.js'

type SinkEvent = Parameters<SessionSink['onEvent']>[0]

// `@vynel/session/runtime` is mocked above, so the real feed class is
// unavailable — a recording fake stands in (and lets tests assert the
// begin/end announcement wiring).
function fakeActivityFeed() {
  const handle = {
    turnId: 'turn-1',
    sessionResolved: vi.fn(),
    publishTurnStep: vi.fn(),
    end: vi.fn(),
  }
  const begin = vi.fn(() => handle)
  return { feed: { begin } as unknown as SessionActivityFeed, begin, handle }
}

function fakeDeps(activityFeed: SessionActivityFeed = fakeActivityFeed().feed) {
  return {
    db: {} as unknown as Database,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    appRequest: vi.fn(),
    activityFeed,
  }
}

beforeEach(() => {
  coreMock.mockReset()
})

describe('runGlobalRootTurn', () => {
  it('drains the sink: accumulates text chunks + captures the session id', async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'sess-1' },
      } as SinkEvent)
      await sink.onEvent({ kind: 'text-chunk', messageId: 'm1', textDelta: 'Hello ' })
      await sink.onEvent({ kind: 'text-chunk', messageId: 'm1', textDelta: 'world' })
      await sink.onEnd?.()
    })

    const result = await runGlobalRootTurn(fakeDeps(), { userId: 'u1', userMessageText: 'hi' })

    expect(result).toEqual({ sessionId: 'sess-1', resultText: 'Hello world' })
    // Composed routing-only with a null build → an empty MCP set reaches the core.
    expect(coreMock).toHaveBeenCalledTimes(1)
    const coreInput = coreMock.mock.calls[0]?.[1] as {
      mcpServers: Record<string, unknown>
      allowedMcpToolPatterns: string[]
    }
    expect(coreInput.mcpServers).toEqual({})
    expect(coreInput.allowedMcpToolPatterns).toEqual([])
  })

  it('forwards approval-requested to onApprovalRequested (the channel card push, surface-up)', async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'sess-1' },
      } as SinkEvent)
      await sink.onEvent({
        kind: 'approval-requested',
        approvalRequestId: 'appr-brain-1',
        parentMessageId: 'm1',
        toolName: 'register_workspace',
        toolInput: { name: 'acme' },
      } as SinkEvent)
      await sink.onEvent({ kind: 'text-chunk', messageId: 'm1', textDelta: 'done' })
      await sink.onEnd?.()
    })

    const approvals: { approvalRequestId: string; toolName: string; toolInput: unknown }[] = []
    const result = await runGlobalRootTurn(fakeDeps(), {
      userId: 'u1',
      userMessageText: 'set up acme',
      onApprovalRequested: (approval) => approvals.push(approval),
    })

    expect(result.resultText).toBe('done')
    expect(approvals).toEqual([
      { approvalRequestId: 'appr-brain-1', toolName: 'register_workspace', toolInput: { name: 'acme' } },
    ])
  })

  it('announces the turn on the activity feed: begin with the channel origin, session resolved, end', async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'sess-1' },
      } as SinkEvent)
      await sink.onEnd?.()
    })

    const activity = fakeActivityFeed()
    await runGlobalRootTurn(fakeDeps(activity.feed), {
      userId: 'u1',
      userMessageText: 'hi',
      originChannel: 'telegram',
    })

    expect(activity.begin).toHaveBeenCalledWith({
      userId: 'u1',
      scopeKind: 'global',
      origin: 'telegram',
    })
    expect(activity.handle.sessionResolved).toHaveBeenCalledWith('sess-1')
    expect(activity.handle.end).toHaveBeenCalledTimes(1)
  })

  it('ends the activity turn even when the core throws', async () => {
    coreMock.mockRejectedValue(new Error('provider down'))

    const activity = fakeActivityFeed()
    await expect(
      runGlobalRootTurn(fakeDeps(activity.feed), { userId: 'u1', userMessageText: 'hi' }),
    ).rejects.toThrow('provider down')
    expect(activity.handle.end).toHaveBeenCalledTimes(1)
  })

  it('throws when the turn produced no session id (no user-message-persisted)', async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({ kind: 'text-chunk', messageId: 'm1', textDelta: 'orphan' })
      await sink.onEnd?.()
    })

    await expect(
      runGlobalRootTurn(fakeDeps(), { userId: 'u1', userMessageText: 'hi' }),
    ).rejects.toThrow(/did not assign a session id/)
  })

  it('throws with the in-stream error message when a session-errored event was captured', async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'sess-1' },
      } as SinkEvent)
      await sink.onEvent({
        kind: 'session-errored',
        sessionId: 'sess-1',
        errorCode: 'provider_error',
        errorMessage: 'boom',
        isRecoverable: false,
      })
      await sink.onEnd?.()
    })

    await expect(
      runGlobalRootTurn(fakeDeps(), { userId: 'u1', userMessageText: 'hi' }),
    ).rejects.toThrow(/the global-root turn errored: boom/)
  })

  it('threads the notify-variant fields to the core (session-comms): child attribution, steer append, feed origin delegation', async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'root-sess-1' },
      } as SinkEvent)
      await sink.onEnd?.()
    })

    const activity = fakeActivityFeed()
    await runGlobalRootTurn(fakeDeps(activity.feed), {
      userId: 'u1',
      userMessageText: 'Backlog has 4 stale items.',
      inboundAttribution: {
        sourceKind: 'workspace-manager',
        sourceLabel: 'Acme research',
        partialSessionId: 'delivery-trace-1',
      },
      steerPromptAppend: REPORT_DELIVERY_INSTRUCTIONS,
      activityOrigin: 'delegation',
    })

    // The feed reports what is actually running — a delegation-driven turn.
    // test: correct expectation — persona-sessions enriches the delivery
    // turn's begin with the trace key + the speaking child's name.
    expect(activity.begin).toHaveBeenCalledWith({
      userId: 'u1',
      scopeKind: 'global',
      origin: 'delegation',
      partialSessionId: 'delivery-trace-1',
      personaName: 'Acme research',
    })
    const coreInput = coreMock.mock.calls[0]?.[1] as {
      messageAttribution?: Record<string, unknown>
      steerPromptAppend?: string
    }
    expect(coreInput.messageAttribution).toEqual({
      userSourceKind: 'workspace-manager',
      userSourceLabel: 'Acme research',
      partialSessionId: 'delivery-trace-1',
    })
    expect(coreInput.steerPromptAppend).toBe(REPORT_DELIVERY_INSTRUCTIONS)
  })

  it('a normal turn threads NEITHER notify field (the shipped core input, byte-for-byte)', async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'sess-1' },
      } as SinkEvent)
      await sink.onEnd?.()
    })
    await runGlobalRootTurn(fakeDeps(), { userId: 'u1', userMessageText: 'hi' })
    const coreInput = coreMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(coreInput).not.toHaveProperty('messageAttribution')
    expect(coreInput).not.toHaveProperty('steerPromptAppend')
  })

  it('buildGlobalRootReportTurnRunner runs ONE notify turn and returns the session id + reply', async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'root-sess-9' },
      } as SinkEvent)
      await sink.onEvent({ kind: 'text-chunk', messageId: 'm1', textDelta: 'Absorbed.' })
      await sink.onEnd?.()
    })

    const activity = fakeActivityFeed()
    const runReportTurn = buildGlobalRootReportTurnRunner(fakeDeps(activity.feed))
    const turn = await runReportTurn({
      userId: 'u1',
      reportBody: 'All docs current.',
      sourceLabel: 'Mark · Acme',
      partialSessionId: 'delivery-trace-2',
    })

    expect(turn).toEqual({ sessionId: 'root-sess-9', resultText: 'Absorbed.' })
    const coreInput = coreMock.mock.calls[0]?.[1] as {
      userMessageText: string
      messageAttribution?: Record<string, unknown>
      steerPromptAppend?: string
    }
    expect(coreInput.userMessageText).toBe('All docs current.')
    expect(coreInput.messageAttribution).toEqual({
      userSourceKind: 'workspace-manager',
      userSourceLabel: 'Mark · Acme',
      partialSessionId: 'delivery-trace-2',
    })
    expect(coreInput.steerPromptAppend).toBe(REPORT_DELIVERY_INSTRUCTIONS)
    // test: correct expectation — the runner threads the enrichment too.
    expect(activity.begin).toHaveBeenCalledWith({
      userId: 'u1',
      scopeKind: 'global',
      origin: 'delegation',
      partialSessionId: 'delivery-trace-2',
      personaName: 'Mark · Acme',
    })
  })

  it('wrapAppRequestWithOrigin stamps the serialized origin header on every dispatch', async () => {
    const seen: (RequestInit | undefined)[] = []
    const appRequest = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      seen.push(init)
      return new Response('ok')
    })
    const origin = { channelId: 'c1', externalSenderId: 's1', externalChatContextId: 'ctx1' }

    const wrapped = wrapAppRequestWithOrigin(appRequest, origin)
    await wrapped('/routing/delegate', { method: 'POST' })

    const headers = new Headers(seen[0]?.headers)
    expect(headers.get(DELEGATION_ORIGIN_HEADER)).toBe(serializeDelegationOrigin(origin))
  })
})

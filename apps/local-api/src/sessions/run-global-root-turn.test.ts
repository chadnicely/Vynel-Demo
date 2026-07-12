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
import type { SessionSink } from '@vynel/session/runtime'

const { coreMock } = vi.hoisted(() => ({ coreMock: vi.fn() }))

vi.mock('@vynel/session/runtime', () => ({ runGlobalRootTurnCore: coreMock }))

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

import { runGlobalRootTurn, wrapAppRequestWithOrigin } from './run-global-root-turn.js'
import { DELEGATION_ORIGIN_HEADER, serializeDelegationOrigin } from './delegation-origin-header.js'

type SinkEvent = Parameters<SessionSink['onEvent']>[0]

function fakeDeps() {
  return {
    db: {} as unknown as Database,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    appRequest: vi.fn(),
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

// Unit tests for `drainLeafTurn` — pure stream consumption; no DB, no provider.

import { describe, expect, it } from 'vitest'
import type { NormalizedSessionEvent } from '@vynel/providers'
import { drainLeafTurn } from './drain-leaf-turn.js'

async function* streamOf(
  ...events: NormalizedSessionEvent[]
): AsyncIterable<NormalizedSessionEvent> {
  for (const event of events) yield event
}

describe('drainLeafTurn', () => {
  it('captures the session id and accumulates the assistant answer text', async () => {
    const drained = await drainLeafTurn(
      streamOf(
        { kind: 'session-started', sessionId: 'leaf-1', resumedFromExisting: false, startedAt: new Date() },
        { kind: 'text-chunk', sessionId: 'leaf-1', messageId: 'm1', textDelta: 'Hello ', isFinalChunk: false },
        { kind: 'text-chunk', sessionId: 'leaf-1', messageId: 'm1', textDelta: 'world', isFinalChunk: true },
        { kind: 'session-completed', sessionId: 'leaf-1', isNewSession: true, completedAt: new Date() },
      ),
    )
    expect(drained.sessionId).toBe('leaf-1')
    expect(drained.resultText).toBe('Hello world')
  })

  it('throws when the leaf session errors', async () => {
    await expect(
      drainLeafTurn(
        streamOf(
          { kind: 'session-started', sessionId: 'leaf-2', resumedFromExisting: false, startedAt: new Date() },
          {
            kind: 'session-errored',
            sessionId: 'leaf-2',
            errorCode: 'boom',
            errorMessage: 'kaboom',
            isRecoverable: false,
            erroredAt: new Date(),
          },
        ),
      ),
    ).rejects.toThrow(/leaf session errored/)
  })

  it('throws when the runtime assigns no session id', async () => {
    await expect(
      drainLeafTurn(
        streamOf({ kind: 'text-chunk', sessionId: 'x', messageId: 'm', textDelta: 'hi', isFinalChunk: true }),
      ),
    ).rejects.toThrow(/did not assign a session id/)
  })

  // ── C1: a routed leaf must FAIL-CLOSED on a carded tool, never deadlock ──

  it('resolves a routed leaf approval (fail-closed) and still completes — no deadlock', async () => {
    const denied: string[] = []
    const drained = await drainLeafTurn(
      streamOf(
        { kind: 'session-started', sessionId: 'leaf-3', resumedFromExisting: false, startedAt: new Date() },
        {
          kind: 'approval-requested',
          sessionId: 'leaf-3',
          approvalRequestId: 'a1',
          parentMessageId: '',
          toolName: 'Bash',
          toolInput: {},
          requestedAt: new Date(),
        },
        { kind: 'text-chunk', sessionId: 'leaf-3', messageId: 'm1', textDelta: 'done as text', isFinalChunk: true },
        { kind: 'session-completed', sessionId: 'leaf-3', isNewSession: true, completedAt: new Date() },
      ),
      { onApprovalRequested: (event) => { denied.push(event.approvalRequestId) } },
    )
    expect(denied).toEqual(['a1'])
    expect(drained.sessionId).toBe('leaf-3')
    expect(drained.resultText).toBe('done as text')
  })

  it('throws (fail-loud) on an approval with no handler — never silently deadlocks', async () => {
    await expect(
      drainLeafTurn(
        streamOf(
          { kind: 'session-started', sessionId: 'leaf-4', resumedFromExisting: false, startedAt: new Date() },
          {
            kind: 'approval-requested',
            sessionId: 'leaf-4',
            approvalRequestId: 'a2',
            parentMessageId: '',
            toolName: 'Write',
            toolInput: {},
            requestedAt: new Date(),
          },
        ),
      ),
    ).rejects.toThrow(/fail-closed/)
  })

  // ── Ch3.5 write-fast-fail: the denial circuit-breaker (counts DENIED resolutions) ──

  const carded = (sessionId: string, id: string): NormalizedSessionEvent => ({
    kind: 'approval-requested',
    sessionId,
    approvalRequestId: id,
    parentMessageId: '',
    toolName: 'Write',
    toolInput: {},
    requestedAt: new Date(),
  })

  const denied = (sessionId: string, id: string): NormalizedSessionEvent => ({
    kind: 'approval-resolved',
    sessionId,
    approvalRequestId: id,
    decision: { kind: 'denied', reason: 'no' },
    resolvedAt: new Date(),
  })

  const approved = (sessionId: string, id: string): NormalizedSessionEvent => ({
    kind: 'approval-resolved',
    sessionId,
    approvalRequestId: id,
    decision: { kind: 'approved' },
    resolvedAt: new Date(),
  })

  it('trips the breaker after repeated denials — interrupts + returns the blocked note', async () => {
    const interrupted: string[] = []
    const drained = await drainLeafTurn(
      streamOf(
        { kind: 'session-started', sessionId: 'leaf-5', resumedFromExisting: false, startedAt: new Date() },
        carded('leaf-5', 'a1'),
        denied('leaf-5', 'a1'),
        carded('leaf-5', 'a2'),
        denied('leaf-5', 'a2'), // 2nd denial → trips the breaker
        { kind: 'session-interrupted', sessionId: 'leaf-5', interruptedAt: new Date() },
      ),
      {
        onApprovalRequested: () => {},
        maxCardedDenials: 2,
        interruptSession: async (sessionId) => {
          interrupted.push(sessionId)
        },
      },
    )
    expect(interrupted).toEqual(['leaf-5']) // interrupted exactly once
    expect(drained.resultText).toContain("couldn't finish") // the clean blocked note
  })

  it('does NOT trip the breaker on a single denial (a compliant report still flows)', async () => {
    const interrupted: string[] = []
    const drained = await drainLeafTurn(
      streamOf(
        { kind: 'session-started', sessionId: 'leaf-6', resumedFromExisting: false, startedAt: new Date() },
        carded('leaf-6', 'a1'),
        denied('leaf-6', 'a1'),
        { kind: 'text-chunk', sessionId: 'leaf-6', messageId: 'm1', textDelta: 'Cannot write, but here is the summary.', isFinalChunk: true },
        { kind: 'session-completed', sessionId: 'leaf-6', isNewSession: true, completedAt: new Date() },
      ),
      {
        onApprovalRequested: () => {},
        maxCardedDenials: 2,
        interruptSession: async (sessionId) => {
          interrupted.push(sessionId)
        },
      },
    )
    expect(interrupted).toEqual([]) // 1 denial < 2 → no trip
    expect(drained.resultText).toBe('Cannot write, but here is the summary.')
  })

  it('APPROVED decisions never count toward the breaker (surface-up: the user said yes)', async () => {
    const interrupted: string[] = []
    const drained = await drainLeafTurn(
      streamOf(
        { kind: 'session-started', sessionId: 'leaf-8', resumedFromExisting: false, startedAt: new Date() },
        carded('leaf-8', 'a1'),
        approved('leaf-8', 'a1'),
        carded('leaf-8', 'a2'),
        approved('leaf-8', 'a2'),
        carded('leaf-8', 'a3'),
        approved('leaf-8', 'a3'),
        { kind: 'text-chunk', sessionId: 'leaf-8', messageId: 'm1', textDelta: 'All three writes done.', isFinalChunk: true },
        { kind: 'session-completed', sessionId: 'leaf-8', isNewSession: true, completedAt: new Date() },
      ),
      { onApprovalRequested: () => {}, maxCardedDenials: 2, interruptSession: async () => {} },
    )
    expect(interrupted).toEqual([])
    expect(drained.resultText).toBe('All three writes done.')
  })

  it('surfaces each approval-resolved to onApprovalResolved (the wait-gate resume hook)', async () => {
    const resolved: { id: string; kind: string }[] = []
    await drainLeafTurn(
      streamOf(
        { kind: 'session-started', sessionId: 'leaf-9', resumedFromExisting: false, startedAt: new Date() },
        carded('leaf-9', 'a1'),
        approved('leaf-9', 'a1'),
        { kind: 'session-completed', sessionId: 'leaf-9', isNewSession: true, completedAt: new Date() },
      ),
      {
        onApprovalRequested: () => {}, // record-and-park: no response — the stream simply continues
        onApprovalResolved: (event) => {
          resolved.push({ id: event.approvalRequestId, kind: event.decision.kind })
        },
      },
    )
    expect(resolved).toEqual([{ id: 'a1', kind: 'approved' }])
  })

  it('preserves text produced before the breaker trips (appends the note)', async () => {
    const drained = await drainLeafTurn(
      streamOf(
        { kind: 'session-started', sessionId: 'leaf-7', resumedFromExisting: false, startedAt: new Date() },
        { kind: 'text-chunk', sessionId: 'leaf-7', messageId: 'm1', textDelta: 'Here is what I found. ', isFinalChunk: false },
        carded('leaf-7', 'a1'),
        denied('leaf-7', 'a1'),
        carded('leaf-7', 'a2'),
        denied('leaf-7', 'a2'),
        { kind: 'session-interrupted', sessionId: 'leaf-7', interruptedAt: new Date() },
      ),
      { onApprovalRequested: () => {}, maxCardedDenials: 2, interruptSession: async () => {} },
    )
    expect(drained.resultText).toContain('Here is what I found.')
    expect(drained.resultText).toContain("couldn't finish")
  })
})

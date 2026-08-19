// The interactive wall clock (session-hardening arc): expiry fires the stream's
// failure path; parked time (approval / ask) does not count; a normal turn
// clears the clock; the failure path persists the honest row + interrupts the
// live session. Fake timers drive the clock; a real SQLite file backs the row.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { ApprovalWaitGate } from '@vynel/orchestration'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertChatSession, listChatMessagesForSession } from '@vynel/chat/repositories'
import type { ChatTurnEvent } from '@vynel/chat'
import type { Database } from '@vynel/db'

const { interruptChatSessionMock } = vi.hoisted(() => ({
  interruptChatSessionMock: vi.fn(async (_sessionId: string) => undefined),
}))

vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof import('@vynel/providers')>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({ interruptChatSession: interruptChatSessionMock }),
  }
})

import {
  failTurnOnWallClock,
  startTurnWallClock,
  trackApprovalParks,
  TURN_WALL_CLOCK_ERROR_CODE,
} from './turn-wall-clock.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} }

const flushTimers = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('startTurnWallClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires onExpire once the working budget is spent and reports isExpired', async () => {
    const onExpire = vi.fn()
    const clock = startTurnWallClock({
      maxMs: 1_000,
      waitGate: new ApprovalWaitGate(),
      onExpire,
      logger: silentLogger,
    })
    await flushTimers(999)
    expect(onExpire).not.toHaveBeenCalled()
    expect(clock.isExpired).toBe(false)
    await flushTimers(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(clock.isExpired).toBe(true)
    // Never twice.
    await flushTimers(5_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('a normal turn clears the clock — nothing fires afterwards', async () => {
    const onExpire = vi.fn()
    const clock = startTurnWallClock({
      maxMs: 1_000,
      waitGate: new ApprovalWaitGate(),
      onExpire,
      logger: silentLogger,
    })
    await flushTimers(500)
    clock.clear()
    await flushTimers(5_000)
    expect(onExpire).not.toHaveBeenCalled()
    expect(clock.isExpired).toBe(false)
  })

  it('parked time does not count — the budget resumes where it stopped when the decision lands', async () => {
    const onExpire = vi.fn()
    const waitGate = new ApprovalWaitGate()
    startTurnWallClock({ maxMs: 1_000, waitGate, onExpire, logger: silentLogger })
    await flushTimers(400) // 600 left
    waitGate.markParked()
    await flushTimers(10_000) // a long human decision — none of it counts
    expect(onExpire).not.toHaveBeenCalled()
    waitGate.markResolved()
    await flushTimers(599)
    expect(onExpire).not.toHaveBeenCalled()
    await flushTimers(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('trackApprovalParks parks the gate on approval-requested and releases only the card it parked', () => {
    const waitGate = new ApprovalWaitGate()
    const tracker = trackApprovalParks(waitGate)
    const requested = (approvalRequestId: string): ChatTurnEvent => ({
      kind: 'approval-requested',
      approvalRequestId,
      parentMessageId: 'm1',
      toolName: 'Bash',
      toolInput: {},
      requestedAt: new Date(),
    })
    const resolved = (approvalRequestId: string): ChatTurnEvent => ({
      kind: 'approval-resolved',
      approvalRequestId,
      decision: { kind: 'approved' },
      resolvedAt: new Date(),
    })
    tracker.onTurnEvent(requested('a1'))
    expect(waitGate.isParked).toBe(true)
    // A resolution for a card this tracker never parked (an auto-approved
    // sibling) must not release the suspension.
    tracker.onTurnEvent(resolved('stranger'))
    expect(waitGate.isParked).toBe(true)
    tracker.onTurnEvent(resolved('a1'))
    expect(waitGate.isParked).toBe(false)
  })

  it('a throwing onExpire is logged, never an unhandled rejection', async () => {
    const errors: unknown[] = []
    startTurnWallClock({
      maxMs: 100,
      waitGate: new ApprovalWaitGate(),
      onExpire: () => {
        throw new Error('expiry boom')
      },
      logger: { ...silentLogger, error: (ctx: unknown) => errors.push(ctx) },
    })
    await flushTimers(100)
    expect(errors).toHaveLength(1)
  })
})

function seedSession(db: Database, sessionId: string): string {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId,
      userId: user.id,
      workspaceId: null,
      providerId: 'claude',
      startedAt: now,
      title: 'Global brain',
      visibility: 'hidden',
    }),
  )
  return user.id
}

describe('failTurnOnWallClock', () => {
  beforeEach(() => {
    interruptChatSessionMock.mockClear()
  })

  it('persists the honest failure row on the turn session and interrupts it', async () => {
    await withTestDatabase(async (db) => {
      seedSession(db, 'sdk-clocked')
      const failure = await failTurnOnWallClock(
        { db, logger: silentLogger },
        { sessionId: 'sdk-clocked', maxMs: 60 * 60_000 },
      )
      expect(failure).toEqual({
        errorCode: TURN_WALL_CLOCK_ERROR_CODE,
        errorMessage: 'turn exceeded the 60-minute limit',
      })
      const rows = listChatMessagesForSession(db, 'sdk-clocked')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        role: 'assistant',
        errorCode: TURN_WALL_CLOCK_ERROR_CODE,
        errorMessage: 'turn exceeded the 60-minute limit',
      })
      expect(interruptChatSessionMock).toHaveBeenCalledWith('sdk-clocked')
    })
  })

  it('with no resolved session id it reports the failure and touches nothing', async () => {
    await withTestDatabase(async (db) => {
      const failure = await failTurnOnWallClock(
        { db, logger: silentLogger },
        { sessionId: undefined, maxMs: 90_000 },
      )
      expect(failure.errorMessage).toBe('turn exceeded the 1.5-minute limit')
      expect(interruptChatSessionMock).not.toHaveBeenCalled()
    })
  })

  it('an interrupt failure is logged, not thrown — an expiry never dies off its timer', async () => {
    await withTestDatabase(async (db) => {
      seedSession(db, 'sdk-stubborn')
      interruptChatSessionMock.mockRejectedValueOnce(new Error('runtime gone'))
      const warnings: unknown[] = []
      await expect(
        failTurnOnWallClock(
          { db, logger: { ...silentLogger, warn: (ctx: unknown) => warnings.push(ctx) } },
          { sessionId: 'sdk-stubborn', maxMs: 60_000 },
        ),
      ).resolves.toMatchObject({ errorCode: TURN_WALL_CLOCK_ERROR_CODE })
      // The clock's own warn + the interrupt failure.
      expect(warnings).toHaveLength(2)
      expect(listChatMessagesForSession(db, 'sdk-stubborn')).toHaveLength(1)
    })
  })
})

// Background-turns BT1/BT3 at the schedule-fire binding: a fired WORKSPACE
// turn holds the workspace key in the shared `SessionTargetLocks` (parked
// FIFO behind a holder, released when the turn settles) and runs under the
// delegated cap (interrupted on expiry, the fire failing with the typed
// wall-clock error); a GLOBAL fire goes through `runGlobalRootTurn` with the
// schedule origin + the same cap. Driven through the REAL leaf `fireSchedule`
// on a real SQLite DB wherever a run row is the evidence. The runtime's
// `startChatTurn` is swapped for a scripted fake (importOriginal-spread, the
// announce test's pattern), `@vynel/chat`'s `interruptChatSession` for a fake
// that ENDS the scripted stream (so the cap's interrupt is what settles the
// turn — the delegation hard-cap test's repro shape), and the global runner
// for a recorder; everything else is real.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { HonoAppRequestFn } from '../factory.js'

const { fakeStartChatTurn, fakeInterruptChatSession, fakeRunGlobalRootTurn } = vi.hoisted(() => ({
  fakeStartChatTurn: vi.fn(),
  fakeInterruptChatSession: vi.fn(),
  fakeRunGlobalRootTurn: vi.fn(),
}))

vi.mock('@vynel/session/runtime', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, startChatTurn: fakeStartChatTurn }
})
vi.mock('@vynel/chat', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, interruptChatSession: fakeInterruptChatSession }
})
vi.mock('./run-global-root-turn.js', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, runGlobalRootTurn: fakeRunGlobalRootTurn }
})

import { SessionActivityFeed } from '@vynel/session/runtime'
import { SessionTargetLocks } from '@vynel/session/delegation'
import { fireSchedule } from '@vynel/schedules'
import { seedChatOnlySchedule, seedGlobalCustomSchedule } from '@vynel/schedules/test-support'
import type { SessionActivityEvent } from '@vynel/contracts/chat/session-activity'
import { buildScheduleFireDeps } from './build-schedule-fire-deps.js'
import { TurnWallClockExceededError } from './run-global-root-turn.js'

const silentLogger = pino({ level: 'silent' })
const fakeAppRequest = vi.fn(() => new Response('{}', { status: 200 })) as unknown as HonoAppRequestFn
const fakeDb = {} as unknown as Database

const flushMacrotask = () => new Promise((resolve) => setImmediate(resolve))

function collectActivity(feed: SessionActivityFeed, userId: string) {
  const events: SessionActivityEvent[] = []
  feed.subscribe(userId, (event) => events.push(event))
  return events
}

/** A scripted turn: names its session, then runs until `interruptChatSession`
 *  lands for that session, then ends the way an interrupted provider does. */
function neverEndingUntilInterrupted(sessionId: string) {
  let settle: (() => void) | null = null
  const interrupted = new Promise<void>((resolve) => (settle = resolve))
  fakeInterruptChatSession.mockImplementation(async (_providerId: string, id: string) => {
    if (id === sessionId) settle?.()
  })
  fakeStartChatTurn.mockImplementation(async function* () {
    yield { kind: 'session-created', session: { id: sessionId } }
    await interrupted
    yield { kind: 'session-interrupted', sessionId }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fakeInterruptChatSession.mockResolvedValue(undefined)
})

describe('buildScheduleFireDeps — the workspace target lock (BT3)', () => {
  it('a busy workspace key parks the fire FIFO behind the holder; the key frees when the turn settles', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db)
      const workspaceId = schedule.workspaceId!
      const targetLocks = new SessionTargetLocks()
      fakeStartChatTurn.mockImplementation(async function* () {
        yield { kind: 'session-created', session: { id: 'sdk-locked' } }
        yield { kind: 'text-chunk', messageId: 'm1', textDelta: 'done' }
      })
      const deps = await buildScheduleFireDeps({
        appRequest: fakeAppRequest,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        targetLocks,
      })

      // Someone else holds the workspace (a delegated run, a user turn) …
      const releaseHolder = await targetLocks.acquire(workspaceId)
      const firing = fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
        deps,
      )
      await flushMacrotask()
      // … so the fire waits: no turn started, the key stays busy.
      expect(fakeStartChatTurn).not.toHaveBeenCalled()
      expect(targetLocks.isBusy(workspaceId)).toBe(true)

      releaseHolder()
      const run = await firing
      expect(fakeStartChatTurn).toHaveBeenCalledTimes(1)
      expect(run.status).toBe('completed')
      expect(run.chatSessionId).toBe('sdk-locked')
      expect(targetLocks.isBusy(workspaceId)).toBe(false) // released with the turn
    })
  })

  it('releases the key when the fired turn throws mid-stream', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db)
      const targetLocks = new SessionTargetLocks()
      fakeStartChatTurn.mockImplementation(async function* () {
        yield { kind: 'session-created', session: { id: 'sdk-throws' } }
        throw new Error('provider down')
      })
      const deps = await buildScheduleFireDeps({
        appRequest: fakeAppRequest,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        targetLocks,
      })

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
        deps,
      )

      expect(run.status).toBe('failed')
      expect(run.statusMessage).toBe('provider down')
      expect(targetLocks.isBusy(schedule.workspaceId!)).toBe(false)
    })
  })
})

describe('buildScheduleFireDeps — the delegated cap on a fired workspace turn (BT3)', () => {
  it('a fire past the cap is interrupted, fails with the typed wall-clock error, and frees the key', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db)
      const targetLocks = new SessionTargetLocks()
      const feed = new SessionActivityFeed()
      const activity = collectActivity(feed, schedule.userId)
      neverEndingUntilInterrupted('sdk-capped')
      const deps = await buildScheduleFireDeps({
        appRequest: fakeAppRequest,
        logger: silentLogger,
        activityFeed: feed,
        targetLocks,
        hardCapMs: 30,
      })

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'poll' },
        deps,
      )

      // The cap pulled the interrupt on the running session — that is what
      // ended the stream — and the run records the honest outcome.
      expect(fakeInterruptChatSession).toHaveBeenCalledWith('claude', 'sdk-capped')
      expect(run.status).toBe('failed')
      expect(run.statusMessage).toMatch(/^turn exceeded the .*-minute limit$/)
      expect(run.chatSessionId).toBe('sdk-capped')
      expect(targetLocks.isBusy(schedule.workspaceId!)).toBe(false)
      // The feed saw the fire begin as a schedule turn and end failed.
      expect(activity.map((event) => event.kind)).toEqual([
        'turn-started',
        'turn-updated',
        'turn-ended',
      ])
      expect(activity[0]).toMatchObject({
        scopeKind: 'workspace',
        workspaceId: schedule.workspaceId,
        origin: 'schedule',
      })
      expect(activity[2]).toMatchObject({ outcome: 'failed' })
    })
  })

  it('a turn that ends inside the cap is never interrupted', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedChatOnlySchedule(db)
      fakeStartChatTurn.mockImplementation(async function* () {
        yield { kind: 'session-created', session: { id: 'sdk-quick' } }
        yield { kind: 'text-chunk', messageId: 'm1', textDelta: 'quick' }
      })
      const deps = await buildScheduleFireDeps({
        appRequest: fakeAppRequest,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        targetLocks: new SessionTargetLocks(),
        hardCapMs: 60_000,
      })

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
        deps,
      )

      expect(run.status).toBe('completed')
      expect(fakeInterruptChatSession).not.toHaveBeenCalled()
    })
  })
})

describe('buildScheduleFireDeps — the global-root binding (BT1)', () => {
  it('runs the global runner as a schedule turn under the delegated cap, forwarding the session hook', async () => {
    fakeRunGlobalRootTurn.mockImplementation(async (_deps, input) => {
      input.onSessionResolved?.('global-sdk-1')
      return { sessionId: 'global-sdk-1', resultText: 'swept' }
    })
    const feed = new SessionActivityFeed()
    const deps = await buildScheduleFireDeps({
      appRequest: fakeAppRequest,
      logger: silentLogger,
      activityFeed: feed,
      targetLocks: new SessionTargetLocks(),
      hardCapMs: 45_000,
    })
    const onSessionResolved = vi.fn()

    const turn = await deps.startGlobalRootTurn(fakeDb, {
      userId: 'u1',
      userMessageText: 'Sweep my inbox.',
      frame: { marker: '(the fire marker)', sourceLabel: 'Schedule · Inbox sweep' },
      onSessionResolved,
    })

    expect(turn).toEqual({ sessionId: 'global-sdk-1', resultText: 'swept' })
    expect(onSessionResolved).toHaveBeenCalledWith('global-sdk-1')
    const [runnerDeps, runnerInput] = fakeRunGlobalRootTurn.mock.calls[0]!
    expect(runnerDeps).toMatchObject({ db: fakeDb, logger: silentLogger, appRequest: fakeAppRequest, activityFeed: feed })
    expect(runnerInput).toMatchObject({
      userId: 'u1',
      userMessageText: 'Sweep my inbox.',
      activityOrigin: 'schedule',
      wallClock: { maxMs: 45_000 },
      // The fire frame (schedule-fire framing): the marker rides the runner's
      // provider-input marker seam, the row is attributed to the schedule as
      // a system notice, and the explicit autoContinue keeps it a WORK turn.
      channelReplyMarker: '(the fire marker)',
      inboundAttribution: { sourceKind: 'system', sourceLabel: 'Schedule · Inbox sweep' },
      autoContinue: true,
    })
  })

  it('a global fire past the cap lands the runner’s typed wall-clock error on the run row', async () => {
    fakeRunGlobalRootTurn.mockRejectedValue(
      new TurnWallClockExceededError({
        errorCode: 'turn-wall-clock-exceeded',
        errorMessage: 'turn exceeded the 60-minute limit',
      }),
    )
    await withTestDatabase(async (db) => {
      const schedule = seedGlobalCustomSchedule(db)
      const deps = await buildScheduleFireDeps({
        appRequest: fakeAppRequest,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        targetLocks: new SessionTargetLocks(),
      })

      const run = await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'poll' },
        deps,
      )

      expect(run.status).toBe('failed')
      expect(run.statusMessage).toBe('turn exceeded the 60-minute limit')
      expect(fakeStartChatTurn).not.toHaveBeenCalled() // never the workspace path
    })
  })
})

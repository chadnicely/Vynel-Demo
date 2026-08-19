// The channel runner's wall clock against the REAL core (background-turns BT4,
// audit R2-B): a bounded `runGlobalRootTurn` past its budget is interrupted,
// records the streams' failure row, ends its feed turn FAILED, throws the typed
// failure — and RELEASES the `${userId}` root lock, so the next turn runs
// straight through. Real SQLite, the provider registry mocked at the module
// boundary (a fake that HANGS a turn until interrupted — the SDK's shape), the
// heavy MCP builders stubbed; the `streamGlobalRootTurn` wall-clock test's
// harness, minus HTTP. The sink-level choreography (suspension on a parked card,
// the absent-option shape) lives in `run-global-root-turn.test.ts`.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import type { NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'
import type * as ProvidersModule from '@vynel/providers'

const { interruptChatSessionMock, hangResolvers } = vi.hoisted(() => {
  const hangResolvers = new Map<string, () => void>()
  return {
    hangResolvers,
    // A REAL interrupt ends the hung fake turn — the way the SDK runtime ends a
    // session the provider interrupts: the stream closes, no error event.
    interruptChatSessionMock: vi.fn(async (sessionId: string) => {
      hangResolvers.get(sessionId)?.()
      hangResolvers.delete(sessionId)
    }),
  }
})

let nextSdkSessionId = 'sdk-runner-1'
/** The next turn HANGS after its first chunk until interrupted. */
let nextTurnHangs = false
function fakeStartChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
  const sessionId = nextSdkSessionId
  const hangs = nextTurnHangs
  nextTurnHangs = false
  async function* events(): AsyncIterable<NormalizedSessionEvent> {
    yield {
      kind: 'session-started',
      sessionId,
      resumedFromExisting: input.resumeSessionId !== undefined,
      startedAt: new Date(),
    }
    yield {
      kind: 'text-chunk',
      sessionId,
      messageId: 'assistant-m1',
      textDelta: 'Hello from the fake brain.',
      isFinalChunk: true,
    }
    if (hangs) {
      await new Promise<void>((resolve) => hangResolvers.set(sessionId, resolve))
      yield { kind: 'session-interrupted', sessionId, interruptedAt: new Date() }
      return
    }
    yield { kind: 'session-completed', sessionId, isNewSession: true, completedAt: new Date() }
  }
  return events()
}

vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof ProvidersModule>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({
      startChatSession: fakeStartChatSession,
      interruptChatSession: interruptChatSessionMock,
    }),
  }
})
vi.mock('@vynel/mcp', () => ({
  vynelRoutingDescriptor: { serverName: 'vynel', build: () => null },
}))
vi.mock('@vynel/instructions', () => ({
  notebookFeatureDescriptor: { serverName: 'vynel-notebook', build: () => null },
}))

import { SessionActivityFeed, isRootTurnLockBusy, rootTurnLockKey } from '@vynel/session/runtime'
import { listChatMessagesForSession } from '@vynel/chat/repositories'
import { withVynelUserDataDir } from './global-root-workspace.js'
import { runGlobalRootTurn, TurnWallClockExceededError } from './run-global-root-turn.js'

const silentLogger = pino({ level: 'silent' })

beforeEach(() => {
  nextSdkSessionId = `sdk-${randomUUID()}`
  nextTurnHangs = false
  interruptChatSessionMock.mockClear()
  hangResolvers.clear()
})

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

async function withDataDir<T>(run: () => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'vynel-root-runner-'))
  return withVynelUserDataDir(dataDir, run)
}

describe('runGlobalRootTurn — the wall clock against the real core (BT4)', () => {
  it('a channel turn past its budget is interrupted, records the failure row, ends the feed FAILED, throws the typed failure, and FREES the root lock for the next turn', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const activityFeed = new SessionActivityFeed()
      const endedOutcomes: string[] = []
      const unsubscribe = activityFeed.subscribe(user.id, (event) => {
        if (event.kind === 'turn-ended') endedOutcomes.push(event.outcome)
      })
      const deps = { db, logger: silentLogger, appRequest: vi.fn(), activityFeed }
      try {
        await withDataDir(async () => {
          nextTurnHangs = true
          const hungSessionId = nextSdkSessionId
          const capped = runGlobalRootTurn(deps, {
            userId: user.id,
            userMessageText: 'never ends',
            originChannel: 'telegram',
            wallClock: { maxMs: 60 },
          })
          await expect(capped).rejects.toBeInstanceOf(TurnWallClockExceededError)
          await expect(capped).rejects.toMatchObject({
            errorCode: 'turn-wall-clock-exceeded',
            message: 'turn exceeded the 0.001-minute limit',
          })

          // The clock interrupted THE turn's session (no manual release here).
          expect(interruptChatSessionMock).toHaveBeenCalledWith(hungSessionId)
          // The durable fact: the streams' assistant row carrying the error.
          const errored = listChatMessagesForSession(db, hungSessionId).find(
            (message) => message.errorCode === 'turn-wall-clock-exceeded',
          )
          expect(errored?.errorMessage).toBe('turn exceeded the 0.001-minute limit')
          expect(endedOutcomes).toEqual(['failed'])

          // The lock is free the moment the runner has thrown…
          expect(isRootTurnLockBusy(rootTurnLockKey(user.id, false))).toBe(false)
          // …and the next turn runs straight through, unqueued.
          nextSdkSessionId = `sdk-${randomUUID()}`
          const next = await runGlobalRootTurn(deps, {
            userId: user.id,
            userMessageText: 'and again',
            originChannel: 'telegram',
            wallClock: { maxMs: 5_000 },
          })
          expect(next.resultText).toBe('Hello from the fake brain.')
          expect(endedOutcomes).toEqual(['failed', 'ended'])
          expect(interruptChatSessionMock).toHaveBeenCalledTimes(1)
        })
      } finally {
        unsubscribe()
      }
    })
  })

  it('a bounded turn that finishes inside its budget never trips the clock — no interrupt, no failure row', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const deps = {
        db,
        logger: silentLogger,
        appRequest: vi.fn(),
        activityFeed: new SessionActivityFeed(),
      }
      await withDataDir(async () => {
        const turn = await runGlobalRootTurn(deps, {
          userId: user.id,
          userMessageText: 'quick',
          wallClock: { maxMs: 5_000 },
        })
        expect(turn.resultText).toBe('Hello from the fake brain.')
      })
      expect(interruptChatSessionMock).not.toHaveBeenCalled()
      expect(
        listChatMessagesForSession(db, nextSdkSessionId).some((message) => message.errorCode !== null),
      ).toBe(false)
    })
  })
})

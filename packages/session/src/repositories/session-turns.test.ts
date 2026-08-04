// Repository + recorder-seam integration tests for the durable turn envelope
// (persona-sessions) — real SQLite. Proves the lifecycle (start → resolve →
// end), the boot reap, the running-turns rebuild read, the retention purge,
// and that a feed WITH the recorder mirrors begin/resolve/end while a feed
// without one is byte-for-byte the shipped behavior.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Logger } from 'pino'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertSessionTurn,
  resolveSessionTurnSession,
  endSessionTurn,
  reapOrphanedSessionTurns,
  listRunningSessionTurnsForUser,
  purgeEndedSessionTurnsBefore,
} from './session-turns.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { buildSessionTurnRecorder } from '../runtime/session-turn-recorder.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeTurnRow(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    userId,
    scopeKind: 'global' as const,
    workspaceId: null,
    origin: 'web' as const,
    sessionId: null,
    primarySessionId: null,
    jobId: null,
    threadId: null,
    partialSessionId: null,
    startedAt: new Date(),
    endedAt: null,
    endedReason: null,
    ...overrides,
  }
}

describe('session-turns repository', () => {
  it('lifecycle: start → resolve → end; only still-running rows move', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const turn = insertSessionTurn(db, makeTurnRow(user.id))
      expect(turn.endedAt).toBeNull()

      resolveSessionTurnSession(db, turn.id, 'sdk-1')
      expect(listRunningSessionTurnsForUser(db, user.id)[0]!.sessionId).toBe('sdk-1')

      endSessionTurn(db, turn.id, new Date())
      expect(listRunningSessionTurnsForUser(db, user.id)).toEqual([])

      // Ended rows never move again.
      resolveSessionTurnSession(db, turn.id, 'sdk-2')
      endSessionTurn(db, turn.id, new Date('2030-01-01'))
      expect(listRunningSessionTurnsForUser(db, user.id)).toEqual([])
    })
  })

  it('the boot reap closes running rows as orphaned; ended rows untouched', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      insertSessionTurn(db, makeTurnRow(user.id))
      const ended = insertSessionTurn(db, makeTurnRow(user.id))
      endSessionTurn(db, ended.id, new Date())

      expect(reapOrphanedSessionTurns(db, new Date())).toBe(1)
      expect(listRunningSessionTurnsForUser(db, user.id)).toEqual([])
    })
  })

  it('running-turns read is tenant-filtered and oldest-first; purge drops old ENDED rows only', async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      const early = insertSessionTurn(
        db,
        makeTurnRow(owner.id, { startedAt: new Date('2026-01-01T00:00:00Z') }),
      )
      const late = insertSessionTurn(
        db,
        makeTurnRow(owner.id, {
          scopeKind: 'workspace',
          workspaceId: workspace.id,
          jobId: 'job-1',
          startedAt: new Date('2026-01-01T00:01:00Z'),
        }),
      )
      insertSessionTurn(db, makeTurnRow(stranger.id))

      const running = listRunningSessionTurnsForUser(db, owner.id)
      expect(running.map((t) => t.id)).toEqual([early.id, late.id])
      expect(running[1]!.jobId).toBe('job-1')

      const old = insertSessionTurn(db, makeTurnRow(owner.id))
      endSessionTurn(db, old.id, new Date('2026-01-02T00:00:00Z'))
      expect(purgeEndedSessionTurnsBefore(db, new Date('2026-02-01T00:00:00Z'))).toBe(1)
      // Running rows are never purged.
      expect(listRunningSessionTurnsForUser(db, owner.id)).toHaveLength(2)
    })
  })

  it('a feed WITH the recorder mirrors begin/resolve/end into the envelope', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const feed = new SessionActivityFeed({
        turnRecorder: buildSessionTurnRecorder(db, silentLogger),
      })

      const handle = feed.begin({
        userId: user.id,
        scopeKind: 'global',
        origin: 'delegation',
        jobId: 'job-9',
        threadId: 'thread-9',
        partialSessionId: 'trace-9',
        primarySessionId: 'primary-9',
      })
      const [row] = listRunningSessionTurnsForUser(db, user.id)
      expect(row?.id).toBe(handle.turnId)
      expect(row?.origin).toBe('delegation')
      expect(row?.jobId).toBe('job-9')
      expect(row?.threadId).toBe('thread-9')
      expect(row?.partialSessionId).toBe('trace-9')
      expect(row?.primarySessionId).toBe('primary-9')

      handle.sessionResolved('sdk-9')
      expect(listRunningSessionTurnsForUser(db, user.id)[0]!.sessionId).toBe('sdk-9')

      handle.end()
      expect(listRunningSessionTurnsForUser(db, user.id)).toEqual([])
    })
  })

  it('a feed WITHOUT the recorder streams exactly as before (no DB writes)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const feed = new SessionActivityFeed()
      const seen: string[] = []
      const unsubscribe = feed.subscribe(user.id, (event) => seen.push(event.kind))

      const handle = feed.begin({ userId: user.id, scopeKind: 'global', origin: 'web' })
      handle.sessionResolved('sdk-1')
      handle.end()

      expect(seen).toEqual(['turn-started', 'turn-updated', 'turn-ended'])
      expect(listRunningSessionTurnsForUser(db, user.id)).toEqual([])
      unsubscribe()
    })
  })
})

// Integration tests for the lifecycle ops — real SQLite, real outbox rows, a
// real runner where a child is genuinely needed. Pins the row shapes, the
// event co-commits, the settle CAS (exactly one event per process), the cap,
// and the sweep.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { BackgroundProcessRunner } from '../running/background-process-runner.js'
import {
  startBackgroundProcess,
  MAX_RUNNING_PROCESSES_PER_USER,
} from './start-background-process.js'
import { settleBackgroundProcess } from './settle-background-process.js'
import { killBackgroundProcess } from './kill-background-process.js'
import { sweepOrphanedBackgroundProcesses } from './sweep-orphaned-processes.js'
import * as processesRepository from '../repositories/index.js'
import {
  PROCESS_STARTED,
  PROCESS_COMPLETED,
  PROCESS_FAILED,
} from '../processes-events.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'T',
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

function seedRunningRow(db: Database, userId: string, workspaceId: string | null): string {
  const id = randomUUID()
  const now = new Date()
  processesRepository.insertBackgroundProcess(db, {
    id,
    userId,
    workspaceId,
    ownerKind: workspaceId === null ? 'global-root' : 'workspace-primary',
    ownerSessionId: null,
    command: 'pnpm test',
    cwdPath: '/tmp/x',
    status: 'running',
    pid: null,
    exitCode: null,
    failureReason: null,
    outputTail: null,
    timeoutMs: 60_000,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

describe('startBackgroundProcess', () => {
  it('inserts a running row, co-commits process.started, and spawns for real', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const runner = new BackgroundProcessRunner()

      const row = startBackgroundProcess(
        db,
        {
          userId: user.id,
          workspaceId: workspace.id,
          ownerKind: 'workspace-primary',
          command: 'node -e "process.exit(0)"',
          cwdPath: process.cwd(),
        },
        { runner },
      )
      expect(row.status).toBe('running')
      expect(row.command).toBe('node -e "process.exit(0)"')
      expect(row.workspaceId).toBe(workspace.id)
      expect(row.timeoutMs).toBeGreaterThan(0)

      const events = listOutboxEventsByType(db, PROCESS_STARTED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        processId: row.id,
        userId: user.id,
        workspaceId: workspace.id,
      })

      // Let the real child finish so nothing leaks past the test.
      runner.kill(row.id, 'killed')
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
  })

  it('validates the boundary: empty command, bad timeout, owner-session rules, the cap', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const runner = new BackgroundProcessRunner()
      const base = {
        userId: user.id,
        workspaceId: null,
        ownerKind: 'global-root' as const,
        cwdPath: '/tmp/x',
      }

      expect(() =>
        startBackgroundProcess(db, { ...base, command: '   ' }, { runner }),
      ).toThrow(/needs a command/)
      expect(() =>
        startBackgroundProcess(db, { ...base, command: 'x', timeoutMs: 10 }, { runner }),
      ).toThrow(/time out between/)
      expect(() =>
        startBackgroundProcess(
          db,
          { ...base, command: 'x', ownerSessionId: 'sdk-1' },
          { runner },
        ),
      ).toThrow(/Only a spawned-session/)
      expect(() =>
        startBackgroundProcess(
          db,
          { ...base, command: 'x', ownerKind: 'spawned-session' },
          { runner },
        ),
      ).toThrow(/must name its owning session/)

      for (let i = 0; i < MAX_RUNNING_PROCESSES_PER_USER; i += 1) {
        seedRunningRow(db, user.id, null)
      }
      expect(() =>
        startBackgroundProcess(db, { ...base, command: 'x' }, { runner }),
      ).toThrow(/the cap is/)
    })
  })
})

describe('settleBackgroundProcess', () => {
  it('exit 0 → succeeded + process.completed; non-zero → failed + process.failed', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const okId = seedRunningRow(db, user.id, null)
      const badId = seedRunningRow(db, user.id, null)

      const ok = settleBackgroundProcess(db, {
        processId: okId,
        exitCode: 0,
        outputTail: 'all green',
      })
      expect(ok?.status).toBe('succeeded')
      expect(ok?.outputTail).toBe('all green')

      const bad = settleBackgroundProcess(db, {
        processId: badId,
        exitCode: 3,
        outputTail: '3 tests failed',
      })
      expect(bad?.status).toBe('failed')
      expect(bad?.exitCode).toBe(3)

      const completed = listOutboxEventsByType(db, PROCESS_COMPLETED)
      expect(completed).toHaveLength(1)
      expect(completed[0]!.payload).toMatchObject({ processId: okId, exitCode: 0 })
      const failed = listOutboxEventsByType(db, PROCESS_FAILED)
      expect(failed).toHaveLength(1)
      expect(failed[0]!.payload).toMatchObject({ processId: badId, exitCode: 3 })
    })
  })

  it('settles exactly once — the CAS loses the second race and emits NO second event', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const id = seedRunningRow(db, user.id, null)

      expect(settleBackgroundProcess(db, { processId: id, exitCode: 0, outputTail: '' })).not.toBeNull()
      expect(settleBackgroundProcess(db, { processId: id, exitCode: 1, outputTail: '' })).toBeNull()

      expect(listOutboxEventsByType(db, PROCESS_COMPLETED)).toHaveLength(1)
      expect(listOutboxEventsByType(db, PROCESS_FAILED)).toHaveLength(0)
    })
  })
})

describe('killBackgroundProcess', () => {
  it('an ORPHAN (running row, no live child) settles as killed on the spot', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const id = seedRunningRow(db, user.id, null)
      const runner = new BackgroundProcessRunner()

      const row = killBackgroundProcess(db, { userId: user.id, processId: id }, { runner })
      expect(row.status).toBe('failed')
      expect(row.failureReason).toBe('killed')
      expect(listOutboxEventsByType(db, PROCESS_FAILED)).toHaveLength(1)
    })
  })

  it('a terminal process refuses the kill; unknown and foreign answer the identical 404', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const id = seedRunningRow(db, user.id, null)
      const runner = new BackgroundProcessRunner()
      settleBackgroundProcess(db, { processId: id, exitCode: 0, outputTail: '' })

      expect(() =>
        killBackgroundProcess(db, { userId: user.id, processId: id }, { runner }),
      ).toThrow(/already finished/)
      expect(() =>
        killBackgroundProcess(db, { userId: stranger.id, processId: id }, { runner }),
      ).toThrow(/not found/i)
      expect(() =>
        killBackgroundProcess(db, { userId: user.id, processId: randomUUID() }, { runner }),
      ).toThrow(/not found/i)
    })
  })
})

describe('sweepOrphanedBackgroundProcesses', () => {
  it('settles every row a restart left running — the failure events still fire', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const a = seedRunningRow(db, user.id, null)
      const b = seedRunningRow(db, user.id, null)
      const done = seedRunningRow(db, user.id, null)
      settleBackgroundProcess(db, { processId: done, exitCode: 0, outputTail: '' })

      expect(sweepOrphanedBackgroundProcesses(db)).toBe(2)
      for (const id of [a, b]) {
        const row = processesRepository.findBackgroundProcessById(db, id)
        expect(row?.status).toBe('failed')
        expect(row?.failureReason).toBe('restart')
      }
      expect(listOutboxEventsByType(db, PROCESS_FAILED)).toHaveLength(2)
      // A second sweep finds nothing — everything already settled.
      expect(sweepOrphanedBackgroundProcesses(db)).toBe(0)
    })
  })
})

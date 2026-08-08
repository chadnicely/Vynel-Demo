// Tests for the monitors tick. Real SQLite. This is the piece that turns an
// armed watch into a woken session, so the pins here are the ones that matter:
// the half-open window, the enqueue-before-record order, once-vs-recurring, and
// that a failed wake never marks a monitor spent.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertOutboxEvent, listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { createMonitor, listMonitors, listMonitorsForUser, MONITOR_FIRED } from '@vynel/monitors'
import { findDelegationJobById } from '@vynel/orchestration'
import { runMonitorTick } from './run-monitor-tick.js'

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function emitEvent(
  db: Database,
  input: { type: string; payload: Record<string, unknown>; createdAt: Date },
) {
  const id = randomUUID()
  insertOutboxEvent(db, { id, ...input, processedAt: null })
  return id
}

const T0 = 1_700_000_000_000
const at = (offsetMs: number) => new Date(T0 + offsetMs)

describe('runMonitorTick', () => {
  it('scans past the capped outbox read — a match beyond 500 boundary-tied events still fires (B5)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const other = seedUser(db)
      createMonitor(
        db,
        {
          userId: user.id,
          workspaceId: null,
          ownerKind: 'global-root',
          description: 'the needle finishing',
          eventTypes: ['task.completed'],
        },
        { now: () => at(0) },
      )
      // 501 subscribed-type events from ANOTHER tenant, all sharing ONE
      // createdAt (the worst boundary-tie shape), with DETERMINISTIC ids so the
      // pages split exactly at the cap — then the real match, tied too. The
      // pre-fix single capped read saw only foreign events, advanced the
      // watermark to `now`, and lost the wake forever.
      const tied = at(100)
      for (let i = 1; i <= 501; i += 1) {
        insertOutboxEvent(db, {
          id: `e-${String(i).padStart(4, '0')}`,
          type: 'task.completed',
          payload: { userId: other.id },
          createdAt: tied,
          processedAt: null,
        })
      }
      insertOutboxEvent(db, {
        id: 'e-9999',
        type: 'task.completed',
        payload: { userId: user.id, taskId: 'needle' },
        createdAt: tied,
        processedAt: null,
      })

      const result = await runMonitorTick(db, { now: () => at(200) })
      expect(result.firedCount).toBe(1)
      const [row] = listMonitorsForUser(db, { userId: user.id })
      expect(row!.status).toBe('fired')
    })
  })

  it('fires an armed monitor and wakes the global root with the event', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const monitor = createMonitor(
        db,
        {
          userId: user.id,
          workspaceId: null,
          ownerKind: 'global-root',
          description: 'the billing task finishing',
          eventTypes: ['task.completed'],
        },
        { now: () => at(0) },
      )
      emitEvent(db, {
        type: 'task.completed',
        payload: { userId: user.id, taskId: 'task-9' },
        createdAt: at(100),
      })

      const result = await runMonitorTick(db, { now: () => at(200) })

      expect(result.firedCount).toBe(1)
      // The wake is a real queued turn on the owner's conversation.
      const [row] = listMonitorsForUser(db, { userId: user.id })
      expect(row!.status).toBe('fired')
      expect(row!.firedCount).toBe(1)
      expect(monitor.status).toBe('armed') // the pre-tick snapshot, unchanged
    })
  })

  // Arming means "from here on" — a watch must never fire on something that
  // already happened before it existed.
  it('ignores events older than the monitor', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      emitEvent(db, {
        type: 'task.completed',
        payload: { userId: user.id },
        createdAt: at(-5_000),
      })
      createMonitor(
        db,
        {
          userId: user.id,
          workspaceId: null,
          ownerKind: 'global-root',
          description: 'anything',
          eventTypes: ['task.completed'],
        },
        { now: () => at(0) },
      )

      expect((await runMonitorTick(db, { now: () => at(100) })).firedCount).toBe(0)
      expect(listMonitorsForUser(db, { userId: user.id })[0]!.status).toBe('armed')
    })
  })

  // outbox_events is cross-tenant by design — this is the boundary that stops
  // one user's watch firing on another's activity.
  it("never fires on another user's event", async () => {
    await withTestDatabase(async (db) => {
      const owner = seedUser(db)
      const stranger = seedUser(db)
      createMonitor(
        db,
        {
          userId: owner.id,
          workspaceId: null,
          ownerKind: 'global-root',
          description: 'anything',
          eventTypes: ['task.completed'],
        },
        { now: () => at(0) },
      )
      emitEvent(db, {
        type: 'task.completed',
        payload: { userId: stranger.id },
        createdAt: at(100),
      })

      expect((await runMonitorTick(db, { now: () => at(200) })).firedCount).toBe(0)
    })
  })

  it('keeps a recurring monitor armed and fires it again on the next event', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      createMonitor(
        db,
        {
          userId: user.id,
          workspaceId: null,
          ownerKind: 'global-root',
          description: 'every crash',
          eventTypes: ['app.crashed'],
          mode: 'recurring',
        },
        { now: () => at(0) },
      )

      emitEvent(db, { type: 'app.crashed', payload: { userId: user.id }, createdAt: at(100) })
      await runMonitorTick(db, { now: () => at(200) })
      emitEvent(db, { type: 'app.crashed', payload: { userId: user.id }, createdAt: at(300) })
      await runMonitorTick(db, { now: () => at(400) })

      const row = listMonitorsForUser(db, { userId: user.id })[0]!
      expect(row.status).toBe('armed')
      expect(row.firedCount).toBe(2)
    })
  })

  // The half-open window (lastCheckedAt, now]: an event must land in exactly one
  // pass — never twice, never skipped at a boundary.
  it('does not re-fire a recurring monitor on an event it already consumed', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      createMonitor(
        db,
        {
          userId: user.id,
          workspaceId: null,
          ownerKind: 'global-root',
          description: 'every crash',
          eventTypes: ['app.crashed'],
          mode: 'recurring',
        },
        { now: () => at(0) },
      )
      emitEvent(db, { type: 'app.crashed', payload: { userId: user.id }, createdAt: at(100) })

      await runMonitorTick(db, { now: () => at(200) })
      await runMonitorTick(db, { now: () => at(300) })

      expect(listMonitorsForUser(db, { userId: user.id })[0]!.firedCount).toBe(1)
    })
  })

  it('expires a monitor past its deadline instead of firing it', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      createMonitor(
        db,
        {
          userId: user.id,
          workspaceId: null,
          ownerKind: 'global-root',
          description: 'too late',
          eventTypes: ['task.completed'],
          expiresInMs: 60_000,
        },
        { now: () => at(0) },
      )
      emitEvent(db, {
        type: 'task.completed',
        payload: { userId: user.id },
        createdAt: at(70_000),
      })

      const result = await runMonitorTick(db, { now: () => at(80_000) })

      expect(result.expiredCount).toBe(1)
      expect(result.firedCount).toBe(0)
      expect(listMonitorsForUser(db, { userId: user.id })[0]!.status).toBe('expired')
    })
  })

  it('wakes the workspace conversation for a workspace-scoped monitor', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      createMonitor(
        db,
        {
          userId: user.id,
          workspaceId: workspace.id,
          ownerKind: 'workspace-primary',
          description: 'the dev server dying',
          eventTypes: ['app.crashed'],
        },
        { now: () => at(0) },
      )
      emitEvent(db, {
        type: 'app.crashed',
        payload: { userId: user.id, appId: 'app-1' },
        createdAt: at(100),
      })

      await runMonitorTick(db, { now: () => at(200) })

      const row = listMonitors(db, { userId: user.id, workspaceId: workspace.id })[0]!
      expect(row.status).toBe('fired')

      // End-to-end: monitor.fired carries the job it queued, so follow it and
      // check a real wake is sitting on the WORKSPACE's conversation carrying
      // the monitor's own words (the woken turn's only context).
      const fired = listOutboxEventsByType(db, MONITOR_FIRED)[0]!
      const { enqueuedJobId } = fired.payload as { enqueuedJobId: string }
      const job = findDelegationJobById(db, enqueuedJobId)!
      expect(job.jobKind).toBe('report-delivery')
      expect(job.workspaceId).toBe(workspace.id)
      expect(job.taskText).toContain('the dev server dying')
      expect(job.taskText).toContain('app.crashed')
    })
  })

  // A monitor whose wake could not be queued must stay ARMED. Marking it fired
  // would drop the notification silently — the exact failure the feature exists
  // to prevent.
  it('leaves a monitor armed when its wake cannot be enqueued', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      createMonitor(
        db,
        {
          userId: user.id,
          workspaceId: null,
          ownerKind: 'spawned-session',
          ownerSessionId: randomUUID(), // a session that does not exist
          description: 'a doomed wake',
          eventTypes: ['task.completed'],
        },
        { now: () => at(0) },
      )
      emitEvent(db, {
        type: 'task.completed',
        payload: { userId: user.id },
        createdAt: at(100),
      })

      const result = await runMonitorTick(db, {
        now: () => at(200),
        resolveSpawnedRunCwd: () => '/tmp/x',
      })

      expect(result.firedCount).toBe(0)
      const row = listMonitorsForUser(db, { userId: user.id })[0]!
      expect(row.status).toBe('armed')
      // The watermark did NOT advance, so the next pass retries the same event.
      expect(row.lastCheckedAt.getTime()).toBe(at(0).getTime())
    })
  })

  it('respects the payload filter', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      createMonitor(
        db,
        {
          userId: user.id,
          workspaceId: null,
          ownerKind: 'global-root',
          description: 'one specific app',
          eventTypes: ['app.crashed'],
          payloadFilter: { appId: 'app-1' },
        },
        { now: () => at(0) },
      )
      emitEvent(db, {
        type: 'app.crashed',
        payload: { userId: user.id, appId: 'app-2' },
        createdAt: at(100),
      })
      expect((await runMonitorTick(db, { now: () => at(200) })).firedCount).toBe(0)

      emitEvent(db, {
        type: 'app.crashed',
        payload: { userId: user.id, appId: 'app-1' },
        createdAt: at(300),
      })
      expect((await runMonitorTick(db, { now: () => at(400) })).firedCount).toBe(1)
    })
  })
})

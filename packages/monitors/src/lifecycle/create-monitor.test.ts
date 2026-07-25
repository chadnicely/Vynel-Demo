// Tests for `createMonitor` — the arming op. Real SQLite via `@vynel/testing`.
// Pins the validation boundary, the outbox co-commit, and the two invariants
// that make a monitor safe to leave running: it never fires on history, and it
// always has a deadline.

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import { createMonitor, MONITOR_MAX_TTL_MS } from './create-monitor.js'
import { MONITOR_ARMED } from '../monitors-events.js'

describe('createMonitor', () => {
  it('arms a watch and co-commits monitor.armed in the same transaction', async () => {
    await withTestDatabase((db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)

      const monitor = createMonitor(db, {
        userId,
        workspaceId,
        ownerKind: 'workspace-primary',
        description: 'the billing migration finishing',
        eventTypes: ['task.completed'],
      })

      expect(monitor.status).toBe('armed')
      expect(monitor.mode).toBe('once')
      expect(monitor.firedCount).toBe(0)

      const events = listOutboxEventsByType(db, MONITOR_ARMED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ monitorId: monitor.id, userId, workspaceId })
    })
  })

  // Arming means "from here on". Seeding the watermark to now is what stops a
  // fresh monitor firing on something that already happened.
  it('seeds the watermark to arming time so it never fires on history', async () => {
    await withTestDatabase((db) => {
      const { userId } = seedUserWorkspace(db)
      const armedAt = new Date(1_700_000_000_000)

      const monitor = createMonitor(
        db,
        {
          userId,
          workspaceId: null,
          ownerKind: 'global-root',
          description: 'anything',
          eventTypes: ['task.completed'],
        },
        { now: () => armedAt },
      )

      expect(monitor.lastCheckedAt.getTime()).toBe(armedAt.getTime())
    })
  })

  it('always has a deadline, defaulted and bounded', async () => {
    await withTestDatabase((db) => {
      const { userId } = seedUserWorkspace(db)
      const base = {
        userId,
        workspaceId: null,
        ownerKind: 'global-root' as const,
        description: 'anything',
        eventTypes: ['task.completed'],
      }

      const defaulted = createMonitor(db, base)
      expect(defaulted.expiresAt.getTime()).toBeGreaterThan(Date.now())

      expect(() => createMonitor(db, { ...base, expiresInMs: 1_000 })).toThrow(ValidationError)
      expect(() =>
        createMonitor(db, { ...base, expiresInMs: MONITOR_MAX_TTL_MS + 1 }),
      ).toThrow(ValidationError)
    })
  })

  // A wake needs exactly one destination: a spawned-session monitor with no
  // session id could never be delivered, and a global one carrying a session id
  // would be ambiguous about which the tick should honour.
  it('requires exactly one owner destination', async () => {
    await withTestDatabase((db) => {
      const { userId } = seedUserWorkspace(db)
      const base = {
        userId,
        workspaceId: null,
        description: 'anything',
        eventTypes: ['task.completed'],
      }

      expect(() => createMonitor(db, { ...base, ownerKind: 'spawned-session' })).toThrow(
        /must name the session/,
      )
      expect(() =>
        createMonitor(db, { ...base, ownerKind: 'global-root', ownerSessionId: 'sess-1' }),
      ).toThrow(/Only a spawned-session monitor/)
      expect(
        createMonitor(db, {
          ...base,
          ownerKind: 'spawned-session',
          ownerSessionId: 'sess-1',
        }).ownerSessionId,
      ).toBe('sess-1')
    })
  })

  it('rejects an empty watch and dedupes repeated types', async () => {
    await withTestDatabase((db) => {
      const { userId } = seedUserWorkspace(db)
      const base = {
        userId,
        workspaceId: null,
        ownerKind: 'global-root' as const,
        description: 'anything',
      }

      expect(() => createMonitor(db, { ...base, eventTypes: [] })).toThrow(ValidationError)
      expect(() => createMonitor(db, { ...base, eventTypes: ['  '] })).toThrow(ValidationError)
      expect(
        createMonitor(db, { ...base, eventTypes: ['task.completed', 'task.completed'] })
          .eventTypes,
      ).toEqual(['task.completed'])
    })
  })

  it('rejects a blank description — a wake with no reason is unreadable', async () => {
    await withTestDatabase((db) => {
      const { userId } = seedUserWorkspace(db)
      expect(() =>
        createMonitor(db, {
          userId,
          workspaceId: null,
          ownerKind: 'global-root',
          description: '   ',
          eventTypes: ['task.completed'],
        }),
      ).toThrow(ValidationError)
    })
  })
})

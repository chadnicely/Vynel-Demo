// Tests for `stopMonitor` — disarming. Real SQLite. Pins the co-commit, the
// terminal-state guard, and that a monitor id can't be confirmed by probing.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import { createMonitor } from './create-monitor.js'
import { stopMonitor } from './stop-monitor.js'
import { MONITOR_STOPPED } from '../monitors-events.js'

function armOne(db: Parameters<typeof createMonitor>[0], userId: string) {
  return createMonitor(db, {
    userId,
    workspaceId: null,
    ownerKind: 'global-root',
    description: 'anything',
    eventTypes: ['task.completed'],
  })
}

describe('stopMonitor', () => {
  it('disarms an armed monitor and co-commits monitor.stopped', async () => {
    await withTestDatabase((db) => {
      const { userId } = seedUserWorkspace(db)
      const armed = armOne(db, userId)

      const stopped = stopMonitor(db, { userId, monitorId: armed.id })

      expect(stopped.status).toBe('stopped')
      expect(listOutboxEventsByType(db, MONITOR_STOPPED)).toHaveLength(1)
    })
  })

  it('refuses to stop a monitor that is already terminal', async () => {
    await withTestDatabase((db) => {
      const { userId } = seedUserWorkspace(db)
      const armed = armOne(db, userId)
      stopMonitor(db, { userId, monitorId: armed.id })

      expect(() => stopMonitor(db, { userId, monitorId: armed.id })).toThrow(ValidationError)
    })
  })

  // Unknown and not-owned must be indistinguishable, or the error confirms that
  // a monitor id exists (the get_background_run precedent).
  it("treats another user's monitor exactly like an unknown one", async () => {
    await withTestDatabase((db) => {
      const owner = seedUserWorkspace(db)
      const stranger = seedUserWorkspace(db)
      const armed = armOne(db, owner.userId)

      expect(() => stopMonitor(db, { userId: stranger.userId, monitorId: armed.id })).toThrow(
        NotFoundError,
      )
      expect(() => stopMonitor(db, { userId: stranger.userId, monitorId: randomUUID() })).toThrow(
        NotFoundError,
      )
    })
  })
})

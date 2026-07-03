// Test for `recordDelegation` — real SQLite; verifies the session.delegated edge
// is emitted with the LOCKED payload (the overnight-run contract 5a consumes).
// The outbox_events table has no FKs, so no user/workspace fixtures are needed.

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { recordDelegation } from './record-delegation.js'
import { SESSION_DELEGATED, type SessionDelegatedPayload } from '../orchestration-events.js'

describe('recordDelegation', () => {
  it('emits a session.delegated edge with the locked payload shape', async () => {
    await withTestDatabase((db) => {
      recordDelegation(db, {
        parentSessionId: 'root-1',
        childSessionId: 'leaf-1',
        role: 'researcher',
        userId: 'user-1',
      })

      const events = listOutboxEventsByType(db, SESSION_DELEGATED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as SessionDelegatedPayload
      expect(payload.parentSessionId).toBe('root-1')
      expect(payload.childSessionId).toBe('leaf-1')
      expect(payload.role).toBe('researcher')
      expect(payload.userId).toBe('user-1')
      expect(typeof payload.ts).toBe('string')
    })
  })
})

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import { createPlan, PLAN_TITLE_MAX_LENGTH } from './create-plan.js'
import { PLAN_CREATED } from '../plans-events.js'

describe('createPlan', () => {
  it('inserts an open plan and co-commits plan.created', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const plan = createPlan(db, {
        userId,
        workspaceId,
        title: '  Ship the spring campaign  ',
        detail: 'Newsletter + landing page.',
        planDate: '2026-07-24',
        source: 'assistant',
        sessionId: 'session-1',
        taskId: 'task-1',
      })

      expect(plan.title).toBe('Ship the spring campaign') // trimmed
      expect(plan.status).toBe('open')
      expect(plan.planDate).toBe('2026-07-24')
      expect(plan.completedAt).toBeNull()
      expect(plan.sessionId).toBe('session-1')
      expect(plan.taskId).toBe('task-1')

      const events = listOutboxEventsByType(db, PLAN_CREATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        planId: plan.id,
        userId,
        workspaceId,
        planDate: '2026-07-24',
        source: 'assistant',
        createdAt: plan.createdAt.toISOString(),
      })
    })
  })

  it('creates a GLOBAL plan (null workspaceId)', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const plan = createPlan(db, {
        userId,
        workspaceId: null,
        title: 'Global plan',
        planDate: '2026-07-24',
        source: 'user',
      })
      expect(plan.workspaceId).toBeNull()
    })
  })

  it('rejects an empty title and an over-long title', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      expect(() =>
        createPlan(db, { userId, workspaceId, title: '   ', planDate: '2026-07-24', source: 'user' }),
      ).toThrow(ValidationError)
      expect(() =>
        createPlan(db, {
          userId,
          workspaceId,
          title: 'x'.repeat(PLAN_TITLE_MAX_LENGTH + 1),
          planDate: '2026-07-24',
          source: 'user',
        }),
      ).toThrow(ValidationError)
    })
  })

  it('rejects a malformed planDate', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      for (const bad of ['24-07-2026', '2026/07/24', 'tomorrow', '2026-7-4']) {
        expect(() =>
          createPlan(db, { userId, workspaceId, title: 'Dated', planDate: bad, source: 'user' }),
        ).toThrow(ValidationError)
      }
    })
  })
})

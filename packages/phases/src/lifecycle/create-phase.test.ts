import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import {
  createPhase,
  PHASE_TITLE_MAX_LENGTH,
  PHASE_DESCRIPTION_MAX_LENGTH,
} from './create-phase.js'
import { PHASE_CREATED } from '../phases-events.js'

describe('createPhase', () => {
  it('inserts an open phase and co-commits phase.created', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const phase = createPhase(db, {
        userId,
        workspaceId,
        title: '  Phase 1 — Foundations  ',
        description: '  Set up the storefront skeleton.  ',
        sessionId: 'session-1',
      })

      expect(phase.title).toBe('Phase 1 — Foundations') // trimmed
      expect(phase.description).toBe('Set up the storefront skeleton.') // trimmed
      expect(phase.status).toBe('open')
      expect(phase.orderIndex).toBe(0)
      expect(phase.completedAt).toBeNull()
      expect(phase.sessionId).toBe('session-1')

      const events = listOutboxEventsByType(db, PHASE_CREATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        phaseId: phase.id,
        userId,
        workspaceId,
        orderIndex: 0,
        createdAt: phase.createdAt.toISOString(),
      })
    })
  })

  it('appends after the highest existing order index', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      createPhase(db, { userId, workspaceId, title: 'One', description: 'First stage.' })
      const second = createPhase(db, {
        userId,
        workspaceId,
        title: 'Two',
        description: 'Second stage.',
      })
      expect(second.orderIndex).toBe(1)
    })
  })

  it('rejects an empty or over-long title', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      expect(() =>
        createPhase(db, { userId, workspaceId, title: '   ', description: 'Body.' }),
      ).toThrow(ValidationError)
      expect(() =>
        createPhase(db, {
          userId,
          workspaceId,
          title: 'x'.repeat(PHASE_TITLE_MAX_LENGTH + 1),
          description: 'Body.',
        }),
      ).toThrow(ValidationError)
    })
  })

  it('rejects an empty or over-long description', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      expect(() =>
        createPhase(db, { userId, workspaceId, title: 'Stage', description: '   ' }),
      ).toThrow(ValidationError)
      expect(() =>
        createPhase(db, {
          userId,
          workspaceId,
          title: 'Stage',
          description: 'x'.repeat(PHASE_DESCRIPTION_MAX_LENGTH + 1),
        }),
      ).toThrow(ValidationError)
    })
  })
})

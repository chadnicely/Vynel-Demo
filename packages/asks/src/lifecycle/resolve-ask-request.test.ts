import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import { seedUserWorkspace, makeAskRequest, insertAskRequest } from '../test-support.js'
import { resolveAskRequest } from './resolve-ask-request.js'
import { ASK_RESOLVED } from '../asks-events.js'

describe('resolveAskRequest', () => {
  it('answering validates type-aware, stores answers, and co-commits ask.resolved', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const ask = insertAskRequest(db, makeAskRequest(userId, workspaceId))

      const resolved = resolveAskRequest(db, {
        askId: ask.id,
        userId,
        resolution: {
          kind: 'answered',
          answers: { audience: 'Bakery regulars', tone: 'Friendly', 'include-photos': true },
        },
      })

      expect(resolved.status).toBe('answered')
      expect(resolved.validatedAnswers).toEqual({
        audience: 'Bakery regulars',
        tone: 'Friendly',
        'include-photos': true,
      })
      expect(JSON.parse(resolved.answersJson!)).toEqual(resolved.validatedAnswers)

      const events = listOutboxEventsByType(db, ASK_RESOLVED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        askId: ask.id,
        userId,
        workspaceId,
        status: 'answered',
        resolvedAt: resolved.resolvedAt!.toISOString(),
      })
      // Answer content never enters the payload.
      expect(JSON.stringify(events[0]!.payload)).not.toContain('Bakery regulars')
    })
  })

  it('rejects answers that do not fit the form', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const ask = insertAskRequest(db, makeAskRequest(userId, workspaceId))

      // Missing required "audience"; "tone" not among the options; unknown key.
      expect(() =>
        resolveAskRequest(db, {
          askId: ask.id,
          userId,
          resolution: { kind: 'answered', answers: { tone: 'Sarcastic', bogus: 'x' } },
        }),
      ).toThrow(ValidationError)
      // Still pending — a failed answer must not consume the ask.
      expect(
        resolveAskRequest(db, { askId: ask.id, userId, resolution: { kind: 'dismissed' } }).status,
      ).toBe('dismissed')
    })
  })

  it('an optional question may be left unanswered', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const ask = insertAskRequest(db, makeAskRequest(userId, workspaceId))
      const resolved = resolveAskRequest(db, {
        askId: ask.id,
        userId,
        resolution: { kind: 'answered', answers: { audience: 'Regulars', tone: 'Playful' } },
      })
      expect(resolved.validatedAnswers).toEqual({ audience: 'Regulars', tone: 'Playful' })
    })
  })

  it('dismiss resolves without answers; a second resolve conflicts', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const ask = insertAskRequest(db, makeAskRequest(userId, workspaceId))

      const dismissed = resolveAskRequest(db, {
        askId: ask.id,
        userId,
        resolution: { kind: 'dismissed' },
      })
      expect(dismissed.status).toBe('dismissed')
      expect(dismissed.answersJson).toBeNull()

      expect(() =>
        resolveAskRequest(db, { askId: ask.id, userId, resolution: { kind: 'dismissed' } }),
      ).toThrow(ConflictError)
    })
  })

  it('404s identically on missing and not-owned asks', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      const ask = insertAskRequest(db, makeAskRequest(userId, workspaceId))

      expect(() =>
        resolveAskRequest(db, { askId: 'missing', userId, resolution: { kind: 'dismissed' } }),
      ).toThrow(NotFoundError)
      expect(() =>
        resolveAskRequest(db, {
          askId: ask.id,
          userId: other.userId,
          resolution: { kind: 'dismissed' },
        }),
      ).toThrow(NotFoundError)
    })
  })
})

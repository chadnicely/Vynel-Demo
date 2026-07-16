import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { seedUserWorkspace, makeQuestions } from '../test-support.js'
import { createAskRequest } from './create-ask-request.js'
import { ASK_CREATED } from '../asks-events.js'

describe('createAskRequest', () => {
  it('inserts a pending ask and co-commits ask.created (labels only, never answers)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const ask = createAskRequest(db, { userId, workspaceId, questions: makeQuestions() })

      expect(ask.status).toBe('pending')
      expect(ask.answersJson).toBeNull()
      expect(JSON.parse(ask.questionsJson)).toHaveLength(3)

      const events = listOutboxEventsByType(db, ASK_CREATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        askId: ask.id,
        userId,
        workspaceId,
        questionCount: 3,
        firstQuestionLabel: 'Who is this newsletter for?',
        createdAt: ask.createdAt.toISOString(),
      })
    })
  })

  it('creates a GLOBAL ask (null workspaceId)', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const ask = createAskRequest(db, { userId, workspaceId: null, questions: makeQuestions() })
      expect(ask.workspaceId).toBeNull()
    })
  })

  it('rejects an invalid question set (choice without options, duplicate ids)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      expect(() =>
        createAskRequest(db, {
          userId,
          workspaceId,
          questions: [{ id: 'tone', label: 'Tone?', type: 'choice' }],
        }),
      ).toThrow(ValidationError)
      expect(() =>
        createAskRequest(db, {
          userId,
          workspaceId,
          questions: [
            { id: 'a', label: 'One', type: 'text' },
            { id: 'a', label: 'Two', type: 'text' },
          ],
        }),
      ).toThrow(ValidationError)
    })
  })
})

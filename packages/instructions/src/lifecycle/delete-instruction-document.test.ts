import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { createInstructionDocument } from './create-instruction-document.js'
import { deleteInstructionDocument } from './delete-instruction-document.js'
import { findDocumentById } from '../repositories/index.js'
import { INSTRUCTION_DELETED } from '../instructions-events.js'

function seedUserAndDocument(db: Database) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const document = createInstructionDocument(db, {
    userId: user.id,
    scope: 'global',
    title: 'Doomed',
    body: 'Soon gone.',
  })
  return { user, document }
}

describe('deleteInstructionDocument', () => {
  it('hard-deletes the row + publishes an instruction.deleted event', async () => {
    await withTestDatabase((db) => {
      const { user, document } = seedUserAndDocument(db)
      deleteInstructionDocument(db, document.id)

      expect(findDocumentById(db, document.id)).toBeNull()
      const events = listOutboxEventsByType(db, INSTRUCTION_DELETED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        documentId: document.id,
        userId: user.id,
        scope: 'global',
        mode: 'notebook',
      })
    })
  })

  it('throws NotFoundError for an unknown id and publishes nothing', async () => {
    await withTestDatabase((db) => {
      seedUserAndDocument(db)
      expect(() => deleteInstructionDocument(db, randomUUID())).toThrow(NotFoundError)
      expect(listOutboxEventsByType(db, INSTRUCTION_DELETED)).toHaveLength(0)
    })
  })
})

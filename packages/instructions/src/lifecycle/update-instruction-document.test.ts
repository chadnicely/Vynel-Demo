import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { createInstructionDocument } from './create-instruction-document.js'
import { updateInstructionDocument } from './update-instruction-document.js'
import { findDocumentById } from '../repositories/index.js'
import { INSTRUCTION_UPDATED } from '../instructions-events.js'

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
    title: 'Original',
    body: 'Original body.',
  })
  return { user, document }
}

describe('updateInstructionDocument', () => {
  it('patches fields + publishes an instruction.updated event naming the changed fields', async () => {
    await withTestDatabase((db) => {
      const { document } = seedUserAndDocument(db)
      const updated = updateInstructionDocument(db, document.id, {
        title: 'Renamed',
        enabled: false,
      })
      expect(updated.title).toBe('Renamed')
      expect(updated.enabled).toBe(false)
      expect(updated.body).toBe('Original body.')

      const events = listOutboxEventsByType(db, INSTRUCTION_UPDATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        documentId: document.id,
        updatedFields: ['title', 'enabled'],
      })
    })
  })

  it('throws NotFoundError for an unknown id and publishes nothing', async () => {
    await withTestDatabase((db) => {
      seedUserAndDocument(db)
      expect(() => updateInstructionDocument(db, randomUUID(), { title: 'x' })).toThrow(
        NotFoundError,
      )
      expect(listOutboxEventsByType(db, INSTRUCTION_UPDATED)).toHaveLength(0)
    })
  })

  it('filters present-but-undefined keys out of updatedFields', async () => {
    await withTestDatabase((db) => {
      const { document } = seedUserAndDocument(db)
      const updated = updateInstructionDocument(db, document.id, {
        title: 'Renamed',
        body: undefined,
      })
      expect(updated.title).toBe('Renamed')

      const events = listOutboxEventsByType(db, INSTRUCTION_UPDATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ updatedFields: ['title'] })
    })
  })

  it('rejects an effectively-empty patch with ValidationError and publishes nothing', async () => {
    await withTestDatabase((db) => {
      const { document } = seedUserAndDocument(db)
      expect(() => updateInstructionDocument(db, document.id, {})).toThrow(ValidationError)
      expect(() => updateInstructionDocument(db, document.id, { title: undefined })).toThrow(
        ValidationError,
      )
      expect(listOutboxEventsByType(db, INSTRUCTION_UPDATED)).toHaveLength(0)
    })
  })

  it('a failing patch validation leaves the row and the outbox untouched (rollback-by-construction)', async () => {
    await withTestDatabase((db) => {
      const { document } = seedUserAndDocument(db)
      expect(() => updateInstructionDocument(db, document.id, { body: '   ' })).toThrow(
        ValidationError,
      )
      expect(findDocumentById(db, document.id)?.body).toBe('Original body.')
      expect(listOutboxEventsByType(db, INSTRUCTION_UPDATED)).toHaveLength(0)
    })
  })
})

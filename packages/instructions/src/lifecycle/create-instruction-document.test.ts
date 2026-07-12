import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { ValidationError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { createInstructionDocument } from './create-instruction-document.js'
import { listDocumentsForUser } from '../repositories/index.js'
import { INSTRUCTION_CREATED } from '../instructions-events.js'

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

describe('createInstructionDocument', () => {
  it('persists a notebook-mode row + publishes an instruction.created outbox event', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const row = createInstructionDocument(db, {
        userId: user.id,
        scope: 'global',
        title: '  Our tone of voice  ',
        body: 'Plain language, always.',
      })

      expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(row.title).toBe('Our tone of voice')
      // Mode is pinned to 'notebook' — the 'always' arc is deferred.
      expect(row.mode).toBe('notebook')
      expect(row.enabled).toBe(true)
      expect(row.sortOrder).toBe(0)

      const events = listOutboxEventsByType(db, INSTRUCTION_CREATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        documentId: row.id,
        userId: user.id,
        scope: 'global',
        workspaceId: null,
        mode: 'notebook',
      })
      // Loose refs + scalars only — never the body.
      expect(JSON.stringify(events[0]!.payload)).not.toContain('Plain language')
    })
  })

  it('requires a workspaceId for workspace scope, forbids one for global scope', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      expect(() =>
        createInstructionDocument(db, { userId: user.id, scope: 'workspace', title: 'x', body: 'y' }),
      ).toThrow(ValidationError)
      expect(() =>
        createInstructionDocument(db, {
          userId: user.id,
          scope: 'global',
          workspaceId: randomUUID(),
          title: 'x',
          body: 'y',
        }),
      ).toThrow(ValidationError)
    })
  })

  it('rejects empty/oversized title and body without writing anything', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const attempts = [
        { title: '   ', body: 'y' },
        { title: 'x'.repeat(121), body: 'y' },
        { title: 'x', body: '  ' },
        { title: 'x', body: 'y'.repeat(50_001) },
      ]
      for (const attempt of attempts) {
        expect(() =>
          createInstructionDocument(db, { userId: user.id, scope: 'global', ...attempt }),
        ).toThrow(ValidationError)
      }
      expect(listDocumentsForUser(db, user.id)).toHaveLength(0)
      expect(listOutboxEventsByType(db, INSTRUCTION_CREATED)).toHaveLength(0)
    })
  })
})

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace, hardDeleteWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertDocument,
  findDocumentById,
  listDocumentsForUser,
  updateDocument,
  deleteDocument,
  type NewInstructionDocument,
} from './instruction-documents.js'

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

// `workspaceId` is a real FK — a workspace-scoped doc needs a live workspace row.
function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function documentRow(userId: string, overrides: Partial<NewInstructionDocument> = {}): NewInstructionDocument {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    scope: 'global',
    workspaceId: null,
    mode: 'notebook',
    title: 'A book',
    body: 'Some guidance.',
    enabled: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('instruction-documents repository', () => {
  it('inserts and finds a document; findDocumentById returns null when absent', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const row = insertDocument(db, documentRow(user.id))
      expect(findDocumentById(db, row.id)?.title).toBe('A book')
      expect(findDocumentById(db, randomUUID())).toBeNull()
    })
  })

  it('lists by sortOrder then createdAt, scoped to the user', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const other = seedUser(db)
      insertDocument(db, documentRow(user.id, { title: 'second', sortOrder: 2 }))
      insertDocument(db, documentRow(user.id, { title: 'first', sortOrder: 1 }))
      insertDocument(db, documentRow(other.id, { title: 'not-mine' }))
      expect(listDocumentsForUser(db, user.id).map((d) => d.title)).toEqual(['first', 'second'])
    })
  })

  it('visibleFrom "global" excludes workspace docs; a workspace id sees global + its own', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const workspaceId = seedWorkspace(db, user.id).id
      insertDocument(db, documentRow(user.id, { title: 'global-doc' }))
      insertDocument(
        db,
        documentRow(user.id, { title: 'ws-doc', scope: 'workspace', workspaceId }),
      )
      insertDocument(
        db,
        documentRow(user.id, {
          title: 'other-ws',
          scope: 'workspace',
          workspaceId: seedWorkspace(db, user.id).id,
        }),
      )

      expect(
        listDocumentsForUser(db, user.id, { visibleFrom: 'global' }).map((d) => d.title),
      ).toEqual(['global-doc'])
      expect(
        listDocumentsForUser(db, user.id, { visibleFrom: { workspaceId } }).map((d) => d.title),
      ).toEqual(['global-doc', 'ws-doc'])
    })
  })

  it('a workspace-scoped doc dies with its workspace (FK cascade); global docs survive', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const globalDoc = insertDocument(db, documentRow(user.id, { title: 'global-doc' }))
      const workspaceDoc = insertDocument(
        db,
        documentRow(user.id, { title: 'ws-doc', scope: 'workspace', workspaceId: workspace.id }),
      )

      hardDeleteWorkspace(db, workspace.id)
      expect(findDocumentById(db, workspaceDoc.id)).toBeNull()
      expect(findDocumentById(db, globalDoc.id)?.title).toBe('global-doc')
    })
  })

  it('filters by mode and enabledOnly', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      insertDocument(db, documentRow(user.id, { title: 'on' }))
      insertDocument(db, documentRow(user.id, { title: 'off', enabled: false }))
      insertDocument(db, documentRow(user.id, { title: 'always-doc', mode: 'always' }))

      expect(
        listDocumentsForUser(db, user.id, { mode: 'notebook', enabledOnly: true }).map(
          (d) => d.title,
        ),
      ).toEqual(['on'])
    })
  })

  it('updates the patch fields and bumps updatedAt; deleteDocument reports the outcome', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const created = insertDocument(
        db,
        documentRow(user.id, { createdAt: new Date(Date.now() - 60_000), updatedAt: new Date(Date.now() - 60_000) }),
      )
      const updated = updateDocument(db, created.id, { title: 'renamed', enabled: false })
      expect(updated?.title).toBe('renamed')
      expect(updated?.enabled).toBe(false)
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
      expect(updateDocument(db, randomUUID(), { title: 'x' })).toBeNull()

      expect(deleteDocument(db, created.id)).toBe(true)
      expect(deleteDocument(db, created.id)).toBe(false)
      expect(findDocumentById(db, created.id)).toBeNull()
    })
  })
})

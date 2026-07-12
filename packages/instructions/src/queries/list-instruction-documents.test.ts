import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createInstructionDocument } from '../lifecycle/create-instruction-document.js'
import { insertDocument } from '../repositories/index.js'
import { listInstructionDocuments } from './list-instruction-documents.js'

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

describe('listInstructionDocuments', () => {
  it('returns only notebook-mode docs, filtered by scope and visibility', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const workspaceId = seedWorkspace(db, user.id).id
      createInstructionDocument(db, { userId: user.id, scope: 'global', title: 'g', body: 'g.' })
      createInstructionDocument(db, {
        userId: user.id,
        scope: 'workspace',
        workspaceId,
        title: 'w',
        body: 'w.',
      })
      // An 'always' row (inserted directly — no op writes one in this slice)
      // must never surface through this read.
      const now = new Date()
      insertDocument(db, {
        id: randomUUID(),
        userId: user.id,
        scope: 'global',
        workspaceId: null,
        mode: 'always',
        title: 'hidden-always',
        body: 'x',
        enabled: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })

      expect(listInstructionDocuments(db, { userId: user.id }).map((d) => d.title)).toEqual([
        'g',
        'w',
      ])
      expect(
        listInstructionDocuments(db, { userId: user.id, scope: 'workspace' }).map((d) => d.title),
      ).toEqual(['w'])
      expect(
        listInstructionDocuments(db, { userId: user.id, visibleFrom: 'global' }).map(
          (d) => d.title,
        ),
      ).toEqual(['g'])
      expect(
        listInstructionDocuments(db, { userId: user.id, visibleFrom: { workspaceId } }).map(
          (d) => d.title,
        ),
      ).toEqual(['g', 'w'])
    })
  })

  it('enabledOnly excludes disabled docs', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      createInstructionDocument(db, {
        userId: user.id,
        scope: 'global',
        title: 'off',
        body: 'x',
        enabled: false,
      })
      createInstructionDocument(db, { userId: user.id, scope: 'global', title: 'on', body: 'x' })
      expect(
        listInstructionDocuments(db, { userId: user.id, enabledOnly: true }).map((d) => d.title),
      ).toEqual(['on'])
    })
  })
})

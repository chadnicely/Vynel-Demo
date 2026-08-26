// Pins the NEEDS SETUP stamp: it is one-way, idempotent, and ours to write.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import * as usersRepository from '@vynel/db/repositories/users'
import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import { markWorkspaceSetupComplete } from './mark-setup-complete.js'

function seedUser(db: Database): string {
  const now = new Date()
  return usersRepository.insertUser(db, {
    id: randomUUID(),
    displayName: 'Chad',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: true,
    projectsDirectory: null,
    createdAt: now,
    updatedAt: now,
  }).id
}

function seedWorkspace(db: Database, userId: string): string {
  const now = new Date()
  return workspacesRepository.insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Credit Dispute',
    kind: 'personal',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    continueEnabled: true,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }).id
}

describe('markWorkspaceSetupComplete', () => {
  it('a pulled-in project starts NEEDING setup, and the stamp ends that', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)

      // This is what puts it in NEEDS SETUP in the first place.
      expect(
        workspacesRepository.findWorkspaceById(db, workspaceId)?.setupCompletedAt,
      ).toBeNull()

      const stamped = markWorkspaceSetupComplete(db, workspaceId)

      expect(stamped.setupCompletedAt).toBeInstanceOf(Date)
    })
  })

  it('is idempotent — pressing Done twice never moves the date', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)

      const first = markWorkspaceSetupComplete(db, workspaceId)
      const again = markWorkspaceSetupComplete(db, workspaceId)

      expect(again.setupCompletedAt?.getTime()).toBe(first.setupCompletedAt?.getTime())
    })
  })

  it('an unknown project is a clean NotFound, never a silent no-op', async () => {
    await withTestDatabase(async (db) => {
      expect(() => markWorkspaceSetupComplete(db, randomUUID())).toThrow()
    })
  })
})

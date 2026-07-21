// Unit tests for `findSpawnedSessionById` — the tenant + scope gate mirrors
// the by-segment sibling; real SQLite via @vynel/testing.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import * as primarySessionsRepository from '../repositories/index.js'
import { findSpawnedSessionById } from './find-spawned-session-by-id.js'

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

function seedPrimary(db: Database, userId: string, scope: 'spawned' | 'workspace' | 'global') {
  const now = new Date()
  return primarySessionsRepository.insertPrimarySession(db, {
    id: randomUUID(),
    userId,
    workspaceId: null,
    scope,
    currentSdkSessionId: `sdk-${randomUUID()}`,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

describe('findSpawnedSessionById', () => {
  it('resolves an owned spawned primary by its id', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const spawned = seedPrimary(db, user.id, 'spawned')

      const found = findSpawnedSessionById(db, { userId: user.id, primarySessionId: spawned.id })
      expect(found?.id).toBe(spawned.id)
      expect(found?.currentSdkSessionId).toBe(spawned.currentSdkSessionId)
    })
  })

  it('returns null for unknown, foreign, and non-spawned primaries alike', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const stranger = seedUser(db)
      const foreign = seedPrimary(db, stranger.id, 'spawned')
      const globalPrimary = seedPrimary(db, user.id, 'global')

      expect(
        findSpawnedSessionById(db, { userId: user.id, primarySessionId: randomUUID() }),
      ).toBeNull()
      expect(
        findSpawnedSessionById(db, { userId: user.id, primarySessionId: foreign.id }),
      ).toBeNull()
      expect(
        findSpawnedSessionById(db, { userId: user.id, primarySessionId: globalPrimary.id }),
      ).toBeNull()
    })
  })
})

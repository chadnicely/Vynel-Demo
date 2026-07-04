// Integration tests for `linkPrimarySessionToSdkSession` — real SQLite via
// `withTestDatabase`. Proves the first-turn primary↔SDK link + the
// no-enumeration tenant guard. Spec: build brief Slice 1 §2.1.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NotFoundError } from '@vynel/errors'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertPrimarySession, findPrimarySessionById } from '../repositories/index.js'
import { linkPrimarySessionToSdkSession } from './link-primary-session-to-sdk-session.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'WS',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function seedPrimary(
  db: Parameters<typeof insertPrimarySession>[0],
  userId: string,
  workspaceId: string,
  currentSdkSessionId: string | null,
) {
  const now = new Date()
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    currentSdkSessionId,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

describe('linkPrimarySessionToSdkSession', () => {
  it('links a freshly-created primary (null current) to the first SDK session, no supersession', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, null)

      const linked = linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: 'sdk-first',
      })

      expect(linked.currentSdkSessionId).toBe('sdk-first')
      expect(linked.supersededFromSdkSessionId).toBeNull()
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-first')
    })
  })

  it('throws NotFoundError identically for an unknown primary AND a primary owned by another user', async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      const primary = seedPrimary(db, owner.id, workspace.id, null)

      expect(() =>
        linkPrimarySessionToSdkSession(db, {
          primarySessionId: randomUUID(),
          userId: owner.id,
          sdkSessionId: 'sdk-x',
        }),
      ).toThrow(NotFoundError)

      expect(() =>
        linkPrimarySessionToSdkSession(db, {
          primarySessionId: primary.id,
          userId: stranger.id,
          sdkSessionId: 'sdk-x',
        }),
      ).toThrow(NotFoundError)
    })
  })
})

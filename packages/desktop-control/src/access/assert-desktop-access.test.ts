// The enforcement gate's contract: silence when the grant covers the
// capability, ForbiddenError (with the recovery path in the message)
// otherwise — and ALWAYS closed on an unidentifiable target.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ForbiddenError } from '@vynel/errors'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { assertDesktopAccess, makeDesktopAccessAuthorizer } from './assert-desktop-access.js'
import { grantDesktopAccess } from './grant-desktop-access.js'

function makeUserId(db: Database): string {
  const now = new Date()
  const id = randomUUID()
  insertUser(db, {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

describe('assertDesktopAccess', () => {
  it('denies with the request_desktop_access recovery path when no grant exists', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      expect(() => assertDesktopAccess(db, { userId, appName: 'Discord', required: 'read' }))
        .toThrowError(ForbiddenError)
      expect(() => assertDesktopAccess(db, { userId, appName: 'Discord', required: 'read' }))
        .toThrowError(/request_desktop_access/)
    })
  })

  it('denies when the granted tier does not cover the required capability', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      grantDesktopAccess(db, { userId, appName: 'Discord', tier: 'read', now: new Date() })
      expect(() => assertDesktopAccess(db, { userId, appName: 'Discord', required: 'full' }))
        .toThrowError(/granted tier: "read"/)
    })
  })

  it('passes silently when the grant covers the capability (matched on the normalized key)', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      grantDesktopAccess(db, { userId, appName: 'Discord', tier: 'full', now: new Date() })
      expect(() =>
        assertDesktopAccess(db, { userId, appName: 'DISCORD.exe', required: 'click' }),
      ).not.toThrow()
    })
  })

  it('fails closed on an unidentifiable (empty) target app', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      expect(() => assertDesktopAccess(db, { userId, appName: '  ', required: 'read' }))
        .toThrowError(ForbiddenError)
    })
  })

  it("is per-user: one user's grant never covers another", async () => {
    await withTestDatabase((db) => {
      const granted = makeUserId(db)
      const other = makeUserId(db)
      grantDesktopAccess(db, { userId: granted, appName: 'Discord', tier: 'full', now: new Date() })
      const authorize = makeDesktopAccessAuthorizer(db, other)
      expect(() => authorize('Discord', 'read')).toThrowError(ForbiddenError)
    })
  })
})

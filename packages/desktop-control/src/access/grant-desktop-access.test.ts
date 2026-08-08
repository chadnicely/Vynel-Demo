// Integration tests for the grant/revoke ops — real SQLite via
// `withTestDatabase` (no DB mocking). Asserts the two invariants the ops
// exist for: grants only move UP, and every change co-commits its outbox
// event in the same transaction.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { grantDesktopAccess, revokeDesktopAccess } from './grant-desktop-access.js'
import { findDesktopAppGrant } from '../repositories/desktop-app-grants.js'
import {
  DESKTOP_ACCESS_GRANTED,
  DESKTOP_ACCESS_REVOKED,
  type DesktopAccessGrantedPayload,
} from '../desktop-control-events.js'
import type { Database } from '@vynel/db'

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

describe('grantDesktopAccess', () => {
  it('creates a grant under the NORMALIZED app key and publishes the outbox event', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      const { grant, outcome } = grantDesktopAccess(db, {
        userId,
        appName: 'Discord.exe',
        tier: 'read',
        now: new Date(),
      })
      expect(outcome).toBe('created')
      expect(grant.appName).toBe('discord')
      expect(findDesktopAppGrant(db, userId, 'discord')?.tier).toBe('read')

      const events = listOutboxEventsByType(db, DESKTOP_ACCESS_GRANTED)
      expect(events).toHaveLength(1)
      const payload = events[0]?.payload as DesktopAccessGrantedPayload
      expect(payload.appName).toBe('discord')
      expect(payload.tier).toBe('read')
      expect(payload.previousTier).toBeNull()
    })
  })

  it('upgrades an existing grant and records the previous tier', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      grantDesktopAccess(db, { userId, appName: 'Discord', tier: 'read', now: new Date() })
      const { outcome } = grantDesktopAccess(db, {
        userId,
        appName: 'discord',
        tier: 'full',
        now: new Date(),
      })
      expect(outcome).toBe('upgraded')
      expect(findDesktopAppGrant(db, userId, 'discord')?.tier).toBe('full')

      const events = listOutboxEventsByType(db, DESKTOP_ACCESS_GRANTED)
      expect(events).toHaveLength(2)
      const upgrade = events[1]?.payload as DesktopAccessGrantedPayload
      expect(upgrade.previousTier).toBe('read')
      expect(upgrade.tier).toBe('full')
    })
  })

  it('never downgrades: a lower re-request is a no-op with no event', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      grantDesktopAccess(db, { userId, appName: 'Discord', tier: 'full', now: new Date() })
      const { grant, outcome } = grantDesktopAccess(db, {
        userId,
        appName: 'Discord',
        tier: 'read',
        now: new Date(),
      })
      expect(outcome).toBe('unchanged')
      expect(grant.tier).toBe('full')
      expect(listOutboxEventsByType(db, DESKTOP_ACCESS_GRANTED)).toHaveLength(1)
    })
  })
})

describe('revokeDesktopAccess', () => {
  it('deletes the grant and publishes the revoked event', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      grantDesktopAccess(db, { userId, appName: 'Discord', tier: 'click', now: new Date() })
      const revoked = revokeDesktopAccess(db, { userId, appName: 'DISCORD.exe', now: new Date() })
      expect(revoked?.appName).toBe('discord')
      expect(findDesktopAppGrant(db, userId, 'discord')).toBeNull()
      expect(listOutboxEventsByType(db, DESKTOP_ACCESS_REVOKED)).toHaveLength(1)
    })
  })

  it('returns null (and publishes nothing) when no grant exists', async () => {
    await withTestDatabase((db) => {
      const userId = makeUserId(db)
      expect(revokeDesktopAccess(db, { userId, appName: 'Notepad', now: new Date() })).toBeNull()
      expect(listOutboxEventsByType(db, DESKTOP_ACCESS_REVOKED)).toHaveLength(0)
    })
  })
})

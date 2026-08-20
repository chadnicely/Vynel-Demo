// The turn-time marker's ONE resolution home: whose clock a turn is told.

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { resolveTurnTimeMarker } from './resolve-turn-time-marker.js'

const INSTANT = new Date('2026-08-21T09:51:00.000Z')

function makeUser(timezone: string) {
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone,
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

describe('resolveTurnTimeMarker', () => {
  it("renders the instant in the USER's timezone, not the host process's", async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser('America/Los_Angeles'))
      const marker = resolveTurnTimeMarker(db, user.id, INSTANT)
      expect(marker).toContain('2:51 AM')
      expect(marker).toContain('America/Los_Angeles')
    })
  })

  it('follows the row: a user in Tokyo reads the same instant as their own evening', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser('Asia/Tokyo'))
      const marker = resolveTurnTimeMarker(db, user.id, INSTANT)
      expect(marker).toContain('6:51 PM')
      expect(marker).toContain('Asia/Tokyo')
    })
  })

  it('states UTC for a user row that is gone — never silently borrows the host zone', async () => {
    await withTestDatabase((db) => {
      const marker = resolveTurnTimeMarker(db, crypto.randomUUID(), INSTANT)
      expect(marker).toContain('UTC')
      expect(marker).toContain('9:51 AM')
    })
  })
})

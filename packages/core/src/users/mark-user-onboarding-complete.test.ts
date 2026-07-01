import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/core/errors'
import { getOrCreateLocalUser } from './get-or-create-local-user.js'
import { markUserOnboardingComplete } from './mark-user-onboarding-complete.js'

describe('markUserOnboardingComplete', () => {
  it('flips hasCompletedOnboarding to true', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      expect(user.hasCompletedOnboarding).toBe(false)
      const updated = markUserOnboardingComplete(db, user.id)
      expect(updated.hasCompletedOnboarding).toBe(true)
    })
  })

  it('throws NotFoundError when the user does not exist', async () => {
    await withTestDatabase((db) => {
      expect(() => markUserOnboardingComplete(db, randomUUID())).toThrow(NotFoundError)
    })
  })
})

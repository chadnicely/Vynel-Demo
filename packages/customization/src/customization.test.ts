import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { ValidationError } from '@vynel/errors'
import type { SaveScopeCustomizationRequest } from '@vynel/contracts/customization/customization-http'
import { listCustomizations, saveScopeCustomization, saveTreeLayout } from './index.js'

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

const PIXEL = 'data:image/png;base64,iVBORw0KGgo='

function makeScope(overrides: Partial<SaveScopeCustomizationRequest> = {}): SaveScopeCustomizationRequest {
  return {
    colorSlot: 3,
    customColor: null,
    personaColorSlot: null,
    personaCustomColor: '#1E90FF',
    personaImage: null,
    workspaceImage: PIXEL,
    groups: [{ id: 'toolkit', label: 'Toolkit' }],
    entries: [{ sectionId: 'agents', groupId: 'toolkit', isHidden: false }],
    ...overrides,
  }
}

describe('@vynel/customization', () => {
  it('starts empty, saves a scope whole, lists it back, and a re-save replaces (not duplicates)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      expect(listCustomizations(db, { userId: user.id })).toEqual({ scopes: [], treeLayout: null })

      const saved = saveScopeCustomization(db, {
        userId: user.id,
        scopeKey: 'ws-1',
        customization: makeScope(),
      })
      expect(saved).toMatchObject({
        scopeKey: 'ws-1',
        colorSlot: 3,
        customColor: null,
        personaCustomColor: '#1e90ff',
        workspaceImage: PIXEL,
        groups: [{ id: 'toolkit', label: 'Toolkit' }],
      })

      saveScopeCustomization(db, {
        userId: user.id,
        scopeKey: 'ws-1',
        customization: makeScope({ colorSlot: null, customColor: '#abcdef', workspaceImage: null }),
      })
      saveScopeCustomization(db, { userId: user.id, scopeKey: 'global', customization: makeScope() })

      const listed = listCustomizations(db, { userId: user.id })
      expect(listed.scopes.map((scope) => scope.scopeKey).sort()).toEqual(['global', 'ws-1'])
      expect(listed.scopes.find((scope) => scope.scopeKey === 'ws-1')).toMatchObject({
        customColor: '#abcdef',
        colorSlot: null,
        workspaceImage: null,
      })
    })
  })

  it('is per user — another user sees nothing', async () => {
    await withTestDatabase(async (db) => {
      const owner = seedUser(db)
      const stranger = seedUser(db)
      saveScopeCustomization(db, { userId: owner.id, scopeKey: 'ws-1', customization: makeScope() })
      expect(listCustomizations(db, { userId: stranger.id }).scopes).toEqual([])
    })
  })

  it('refuses a bad colour, a non-image, an oversized image, and two colours at once', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const attempt = (overrides: Partial<SaveScopeCustomizationRequest>) => () =>
        saveScopeCustomization(db, { userId: user.id, scopeKey: 'ws-1', customization: makeScope(overrides) })

      expect(attempt({ personaCustomColor: 'blue' })).toThrow(ValidationError)
      expect(attempt({ workspaceImage: 'javascript:alert(1)' })).toThrow(ValidationError)
      expect(attempt({ workspaceImage: `data:image/png;base64,${'A'.repeat(600 * 1024)}` })).toThrow(
        ValidationError,
      )
      expect(attempt({ colorSlot: 2, customColor: '#123456' })).toThrow(ValidationError)
      expect(listCustomizations(db, { userId: user.id }).scopes).toEqual([])
    })
  })

  it('saves the tree layout whole and replaces it on the next drop', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const first = { groups: ['g2', 'g1'], workspaces: { g1: ['w1'], root: ['w3', 'w2'] } }
      expect(saveTreeLayout(db, { userId: user.id, layout: first })).toEqual(first)

      const second = { groups: ['g1', 'g2'], workspaces: { root: ['w2', 'w3', 'w1'] } }
      saveTreeLayout(db, { userId: user.id, layout: second })
      expect(listCustomizations(db, { userId: user.id }).treeLayout).toEqual(second)
    })
  })
})

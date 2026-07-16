import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ConflictError, NotFoundError } from '@vynel/errors'
import { seedUserWorkspace, makeApp, insertApp } from '../test-support.js'
import { updateApp } from './update-app.js'
import { removeApp } from './remove-app.js'
import { APP_REMOVED, APP_UPDATED } from '../apps-events.js'
import { findAppById } from '../repositories/index.js'

describe('updateApp / removeApp', () => {
  it('patches fields and co-commits app.updated', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const app = insertApp(db, makeApp(userId, workspaceId))

      const updated = updateApp(db, {
        appId: app.id,
        userId,
        command: 'pnpm --filter web start',
        port: null,
      })
      expect(updated.command).toBe('pnpm --filter web start')
      expect(updated.port).toBeNull()
      expect(listOutboxEventsByType(db, APP_UPDATED)).toHaveLength(1)
    })
  })

  it('renaming into another app in the same workspace conflicts; keeping own name is fine', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      insertApp(db, makeApp(userId, workspaceId, { name: 'Api' }))
      const app = insertApp(db, makeApp(userId, workspaceId, { name: 'Web app' }))

      expect(() => updateApp(db, { appId: app.id, userId, name: 'api' })).toThrow(ConflictError)
      expect(updateApp(db, { appId: app.id, userId, name: 'WEB APP' }).name).toBe('WEB APP')
    })
  })

  it('removeApp hard-deletes and co-commits app.removed', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const app = insertApp(db, makeApp(userId, workspaceId))

      removeApp(db, { appId: app.id, userId })
      expect(findAppById(db, app.id)).toBeNull()
      expect(listOutboxEventsByType(db, APP_REMOVED)).toHaveLength(1)
    })
  })

  it('404s identically on missing and not-owned apps', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      const app = insertApp(db, makeApp(userId, workspaceId))

      expect(() => updateApp(db, { appId: 'missing', userId, name: 'Y' })).toThrow(NotFoundError)
      expect(() => updateApp(db, { appId: app.id, userId: other.userId, name: 'Y' })).toThrow(
        NotFoundError,
      )
      expect(() => removeApp(db, { appId: app.id, userId: other.userId })).toThrow(NotFoundError)
    })
  })
})

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ConflictError, ValidationError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import { registerApp } from './register-app.js'
import { APP_REGISTERED } from '../apps-events.js'

describe('registerApp', () => {
  it('inserts the app and co-commits app.registered', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const app = registerApp(db, {
        userId,
        workspaceId,
        name: '  Web app  ',
        command: 'pnpm --filter web dev',
        cwdRelative: 'apps/web',
        port: 8999,
      })

      expect(app.name).toBe('Web app') // trimmed
      expect(app.cwdRelative).toBe('apps/web')
      expect(app.port).toBe(8999)

      const events = listOutboxEventsByType(db, APP_REGISTERED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        appId: app.id,
        userId,
        workspaceId,
        name: 'Web app',
        registeredAt: app.createdAt.toISOString(),
      })
    })
  })

  it('rejects a duplicate name in the workspace (case-insensitive)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      registerApp(db, { userId, workspaceId, name: 'Web app', command: 'pnpm dev' })
      expect(() =>
        registerApp(db, { userId, workspaceId, name: 'WEB APP', command: 'pnpm dev' }),
      ).toThrow(ConflictError)
    })
  })

  it('rejects escaping folders, absolute paths, bad ports, multi-line commands', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const base = { userId, workspaceId, name: 'X', command: 'pnpm dev' }
      expect(() => registerApp(db, { ...base, cwdRelative: '../outside' })).toThrow(ValidationError)
      expect(() => registerApp(db, { ...base, cwdRelative: '/etc' })).toThrow(ValidationError)
      expect(() => registerApp(db, { ...base, cwdRelative: 'C:\\Windows' })).toThrow(
        ValidationError,
      )
      expect(() => registerApp(db, { ...base, port: 70000 })).toThrow(ValidationError)
      expect(() =>
        registerApp(db, { ...base, command: 'pnpm dev\nrm -rf /' }),
      ).toThrow(ValidationError)
    })
  })
})

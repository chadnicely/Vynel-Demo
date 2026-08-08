// Integration tests for the USER-scoped `/desktop/access` routes. Full HTTP
// stack: route -> validator -> userScoped -> leaf op -> repo -> SQLite (real,
// via withTestDatabase). Grants are seeded through the leaf's `grantDesktopAccess`
// (the routes deliberately have NO creation door — consent lives on the
// carded MCP tool).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { grantDesktopAccess, findDesktopAppGrant } from '@vynel/desktop-control'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

describe('desktop-access routes', () => {
  it('GET / lists the user grants; DELETE /:appName revokes (normalized key)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      grantDesktopAccess(db, { userId: user.id, appName: 'Discord', tier: 'click', now: new Date() })
      grantDesktopAccess(db, { userId: user.id, appName: 'Notepad', tier: 'read', now: new Date() })

      const listRes = await app.request('/desktop/access')
      expect(listRes.status).toBe(200)
      const grants = (await listRes.json()) as Array<Record<string, unknown>>
      expect(grants.map((grant) => [grant.appName, grant.tier])).toEqual([
        ['discord', 'click'],
        ['notepad', 'read'],
      ])

      // Revoke matches on the NORMALIZED key — "Discord.exe" revokes "discord".
      const revokeRes = await app.request('/desktop/access/Discord.exe', { method: 'DELETE' })
      expect(revokeRes.status).toBe(204)
      expect(findDesktopAppGrant(db, user.id, 'discord')).toBeNull()
      expect(findDesktopAppGrant(db, user.id, 'notepad')).not.toBeNull()
    })
  })

  it('DELETE of a grant that does not exist is a 404', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser())
      const res = await app.request('/desktop/access/slack', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })

  it('there is NO POST door — grants cannot be created over HTTP', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser())
      const res = await app.request('/desktop/access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appName: 'discord', tier: 'full' }),
      })
      expect([404, 405]).toContain(res.status)
    })
  })
})

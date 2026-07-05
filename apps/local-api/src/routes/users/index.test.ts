// Integration tests for the `/users/me...` routes. Full HTTP stack (route ->
// userScoped -> core op -> repo -> SQLite, real via withTestDatabase). The
// user IS the Phase-1 single local user that `userResolverMiddleware`
// resolves (no cross-user ownership to test here — unlike workspace/channel
// tenant-isolation tests) — seeds use the same `getOrCreateLocalUser`
// identity the route will see, mirroring the `approvals` route tests'
// convention for this same single-user surface.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { getOrCreateLocalUser, setUserPreferences } from '@vynel/core/users'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function jsonPatch(body: unknown): RequestInit {
  return { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

describe('GET /users/me', () => {
  it('returns the resolved user with serialized timestamps', async () => {
    await withTestDatabase(async (db) => {
      const seeded = getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/users/me')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id: string; createdAt: string }
      expect(body.id).toBe(seeded.id)
      expect(typeof body.createdAt).toBe('string')
      expect(new Date(body.createdAt).getTime()).toEqual(seeded.createdAt.getTime())
    })
  })

  it('creates the user on the first request if boot did not (resolver fallback)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/users/me')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { id: string }
      expect(body.id).toBeTruthy()
    })
  })
})

describe('PATCH /users/me', () => {
  it('updates the display name and returns the updated user', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/users/me', jsonPatch({ displayName: 'Alex' }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { displayName: string }
      expect(body.displayName).toBe('Alex')
    })
  })

  it('updates locale and timezone in a single request', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        '/users/me',
        jsonPatch({ locale: 'de-DE', timezone: 'Europe/Berlin' }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { locale: string; timezone: string }
      expect(body.locale).toBe('de-DE')
      expect(body.timezone).toBe('Europe/Berlin')
    })
  })

  it('returns 400 on invalid email address (Zod validation)', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/users/me', jsonPatch({ emailAddress: 'not-an-email' }))
      expect(res.status).toBe(400)
    })
  })
})

describe('GET /users/me/preferences', () => {
  it('returns the resolved preferences with defaults', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/users/me/preferences')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        theme: string
        defaultWorkspaceId: string | null
        chatStreamingEnabled: boolean
        reducedMotion: boolean
      }
      expect(body.theme).toBe('system')
      expect(body.defaultWorkspaceId).toBeNull()
      expect(body.chatStreamingEnabled).toBe(true)
      expect(body.reducedMotion).toBe(false)
    })
  })

  it('returns stored preferences when they exist', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db, { logger: silentLogger })
      setUserPreferences(db, user.id, { theme: 'dark', reducedMotion: true })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/users/me/preferences')
      const body = (await res.json()) as { theme: string; reducedMotion: boolean }
      expect(body.theme).toBe('dark')
      expect(body.reducedMotion).toBe(true)
    })
  })
})

describe('PATCH /users/me/preferences', () => {
  it('updates a single preference and returns the new resolved set', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/users/me/preferences', jsonPatch({ theme: 'dark' }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { theme: string }
      expect(body.theme).toBe('dark')
    })
  })

  it('updates multiple preferences in one request (atomic)', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        '/users/me/preferences',
        jsonPatch({ theme: 'light', chatStreamingEnabled: false, defaultWorkspaceId: 'ws-abc' }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        theme: string
        chatStreamingEnabled: boolean
        defaultWorkspaceId: string | null
      }
      expect(body.theme).toBe('light')
      expect(body.chatStreamingEnabled).toBe(false)
      expect(body.defaultWorkspaceId).toBe('ws-abc')
    })
  })

  it('returns 400 on invalid theme value (Zod validation surface)', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/users/me/preferences', jsonPatch({ theme: 'rainbow' }))
      expect(res.status).toBe(400)
    })
  })
})

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
import { resolveDesktopActionsEnabled } from '../../sessions/resolve-desktop-actions-enabled.js'

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

// Settings → Desktop control. The Zod property name IS the `user_preferences`
// key (`setUserPreferences` upserts by property name), and the runtime reads
// that key through its own resolver — three independent string literals that
// must agree. Only a test that goes route → db → RESOLVER binds them; a
// route→route round trip passes just as happily with a drifted literal.
describe('the desktop acting toggle', () => {
  it('round-trips through the route and is what the next turn resolves', async () => {
    await withTestDatabase(async (db) => {
      const user = getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })

      // Never touched: off, and the runtime agrees.
      const before = (await (await app.request('/users/me/preferences')).json()) as {
        desktopActionsEnabled: boolean
      }
      expect(before.desktopActionsEnabled).toBe(false)
      expect(resolveDesktopActionsEnabled(db, user.id)).toBe(false)

      const on = await app.request(
        '/users/me/preferences',
        jsonPatch({ desktopActionsEnabled: true }),
      )
      expect(on.status).toBe(200)
      expect(((await on.json()) as { desktopActionsEnabled: boolean }).desktopActionsEnabled).toBe(
        true,
      )
      // THE binding: the row the route wrote is the row the runtime reads.
      expect(resolveDesktopActionsEnabled(db, user.id)).toBe(true)

      const off = await app.request(
        '/users/me/preferences',
        jsonPatch({ desktopActionsEnabled: false }),
      )
      expect(((await off.json()) as { desktopActionsEnabled: boolean }).desktopActionsEnabled).toBe(
        false,
      )
      expect(resolveDesktopActionsEnabled(db, user.id)).toBe(false)
    })
  })

  it('survives a re-read (GET reports the stored choice, not the default)', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })
      await app.request('/users/me/preferences', jsonPatch({ desktopActionsEnabled: true }))
      const res = await app.request('/users/me/preferences')
      expect(((await res.json()) as { desktopActionsEnabled: boolean }).desktopActionsEnabled).toBe(
        true,
      )
    })
  })

  it('returns 400 when it is not a boolean (Zod validation surface)', async () => {
    await withTestDatabase(async (db) => {
      getOrCreateLocalUser(db, { logger: silentLogger })
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request(
        '/users/me/preferences',
        jsonPatch({ desktopActionsEnabled: 'yes' }),
      )
      expect(res.status).toBe(400)
    })
  })
})

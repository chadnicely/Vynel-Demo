// The source repo has no colocated test for `first-launch-gate.ts` (verified —
// no `*.test.ts` sibling in `apps/api/src/middleware`), so this is a fresh
// test written for the port, following this repo's local-harness convention
// (`routes/root/index.test.ts`): a bare `Hono<AppEnv>` sets `db`/`logger`,
// applies ONLY the gate middleware, then a dummy protected route — isolating
// the gate from `createApp` (where it mounts behind `enableFirstLaunchGate`).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { Hono } from 'hono'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { startOnboardingRun } from '@vynel/onboarding'
import type { Database } from '@vynel/db'
import type { AppEnv } from '../factory.js'
import { firstLaunchGateMiddleware } from './first-launch-gate.js'

const silentLogger = pino({ level: 'silent' })

function makeHarness(db: Database) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('logger', silentLogger)
    await next()
  })
  app.use('*', firstLaunchGateMiddleware)
  app.get('/onboarding/status/needs-onboarding', (c) => c.json({ ok: true }))
  app.get('/openapi.json', (c) => c.json({ ok: true }))
  app.get('/protected', (c) => c.json({ ok: true }))
  return app
}

function seedUser(db: Database, hasCompletedOnboarding: boolean) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding,
    createdAt: now,
    updatedAt: now,
  })
}

describe('firstLaunchGateMiddleware', () => {
  it('always allows /openapi.json (SDK generator safety) with no db access', async () => {
    await withTestDatabase(async (db) => {
      const app = makeHarness(db)
      const res = await app.request('/openapi.json')
      expect(res.status).toBe(200)
    })
  })

  it('always allows /onboarding* routes', async () => {
    await withTestDatabase(async (db) => {
      const app = makeHarness(db)
      const res = await app.request('/onboarding/status/needs-onboarding')
      expect(res.status).toBe(200)
    })
  })

  it('412s a protected route when no user exists yet', async () => {
    await withTestDatabase(async (db) => {
      const app = makeHarness(db)
      const res = await app.request('/protected')
      expect(res.status).toBe(412)
      const body = (await res.json()) as { code: string; inProgressRunId: string | null }
      expect(body.code).toBe('onboarding_required')
      expect(body.inProgressRunId).toBeNull()
    })
  })

  it('412s a protected route with the inProgressRunId when the user has an open run', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db, false)
      const run = startOnboardingRun(db, user.id)
      const app = makeHarness(db)
      const res = await app.request('/protected')
      expect(res.status).toBe(412)
      const body = (await res.json()) as { inProgressRunId: string | null }
      expect(body.inProgressRunId).toBe(run.id)
    })
  })

  it('passes through once the user has completed onboarding', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db, true)
      const app = makeHarness(db)
      const res = await app.request('/protected')
      expect(res.status).toBe(200)
    })
  })
})

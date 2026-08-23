// Integration tests for the `/onboarding/*` routes. Full HTTP stack against a
// local harness that mounts `onboardingApp` at `/onboarding` with the same DI
// middleware + VynelError onError `createApp` wires (onboardingApp is not
// mounted in app.ts yet — switch this harness to `createApp` from ../../app.js
// once the integrator mounts it), per the `routes/root` not-yet-mounted
// precedent. Real SQLite via `@vynel/testing`.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { withTestDatabase } from '@vynel/testing'
import { VynelError } from '@vynel/errors'
import { insertUser, findUserById } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import type { AppEnv } from '../../factory.js'
import { onboardingApp } from './index.js'

const silentLogger = pino({ level: 'silent' })

// Mirrors createApp's DI middleware + onError for the not-yet-mounted sub-app.
function makeHarness(db: Database) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('logger', silentLogger)
    c.set('appRequest', app.request.bind(app))
    await next()
  })
  app.onError((err, c) => {
    if (err instanceof VynelError) {
      return c.json({ code: err.code, message: err.message }, err.httpStatus as ContentfulStatusCode)
    }
    c.var.logger.error({ err }, 'unhandled error')
    return c.json({ code: 'internal_error', message: 'Internal server error.' }, 500)
  })
  app.route('/onboarding', onboardingApp)
  return app
}

function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

describe('POST /onboarding/start', () => {
  it('starts a fresh run parked at welcome', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await app.request('/onboarding/start', { method: 'POST' })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { currentStepKind: string; status: string }
      expect(body.currentStepKind).toBe('welcome')
      expect(body.status).toBe('in-progress')
    })
  })

  it('is find-or-create — a second call returns the same run', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const first = (await (await app.request('/onboarding/start', { method: 'POST' })).json()) as {
        id: string
      }
      const second = (await (await app.request('/onboarding/start', { method: 'POST' })).json()) as {
        id: string
      }
      expect(second.id).toBe(first.id)
    })
  })
})

describe('POST /onboarding/restart', () => {
  it('abandons the in-progress run and starts a fresh one', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const first = (await (await app.request('/onboarding/start', { method: 'POST' })).json()) as {
        id: string
      }
      const restarted = (await (await app.request('/onboarding/restart', { method: 'POST' })).json()) as {
        id: string
        status: string
      }
      expect(restarted.id).not.toBe(first.id)
      expect(restarted.status).toBe('in-progress')
    })
  })
})

describe('GET /onboarding/status/needs-onboarding', () => {
  it('reflects the fresh-user + in-progress-run state', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const before = (await (await app.request('/onboarding/status/needs-onboarding')).json()) as {
        needsOnboarding: boolean
        inProgressRunId: string | null
      }
      expect(before.needsOnboarding).toBe(true)
      expect(before.inProgressRunId).toBeNull()

      const run = (await (await app.request('/onboarding/start', { method: 'POST' })).json()) as {
        id: string
      }
      const after = (await (await app.request('/onboarding/status/needs-onboarding')).json()) as {
        inProgressRunId: string | null
      }
      expect(after.inProgressRunId).toBe(run.id)
    })
  })
})

describe('GET /onboarding/:runId', () => {
  it('returns the status snapshot for an owned run', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const run = (await (await app.request('/onboarding/start', { method: 'POST' })).json()) as {
        id: string
      }
      const res = await app.request(`/onboarding/${run.id}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { currentStep: { stepKind: string }; totalSteps: number }
      expect(body.currentStep.stepKind).toBe('welcome')
      expect(body.totalSteps).toBe(2)
    })
  })

  it('404s for an unknown run id', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const res = await app.request(`/onboarding/${randomUUID()}`)
      expect(res.status).toBe(404)
    })
  })
})

describe('POST /onboarding/:runId/submit', () => {
  it('advances a DB-only step and updates the user', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const run = (await (await app.request('/onboarding/start', { method: 'POST' })).json()) as {
        id: string
      }
      const res = await app.request(
        `/onboarding/${run.id}/submit`,
        jsonPost({ stepKind: 'welcome', stepInput: { acknowledged: true } }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { currentStepKind: string; completedSteps: string[] }
      expect(body.currentStepKind).toBe('profile')
      expect(body.completedSteps).toContain('welcome')
    })
  })

  it('threads the REAL deps — the profile step updates the boot user', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const app = makeHarness(db)
      const run = (await (await app.request('/onboarding/start', { method: 'POST' })).json()) as {
        id: string
      }
      await app.request(
        `/onboarding/${run.id}/submit`,
        jsonPost({ stepKind: 'welcome', stepInput: { acknowledged: true } }),
      )

      // buildOnboardingDeps binds the real @vynel/core updateUserProfile —
      // DB-only, so it's cheap to exercise through the full HTTP stack. The
      // FS/network-heavy steps stay with the fake-deps package tests + the
      // deferred smoke test.
      const res = await app.request(
        `/onboarding/${run.id}/submit`,
        jsonPost({
          stepKind: 'profile',
          stepInput: { displayName: 'Sam Lee', locale: 'en-GB', timezone: 'Europe/London' },
        }),
      )
      expect(res.status).toBe(200)
      expect(findUserById(db, user.id)?.displayName).toBe('Sam Lee')
      expect(findUserById(db, user.id)?.timezone).toBe('Europe/London')
    })
  })

  it('400s on a step-kind mismatch', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const run = (await (await app.request('/onboarding/start', { method: 'POST' })).json()) as {
        id: string
      }
      const res = await app.request(
        `/onboarding/${run.id}/submit`,
        jsonPost({ stepKind: 'profile', stepInput: {} }),
      )
      expect(res.status).toBe(400)
    })
  })

  it('400s on an invalid stepKind (Zod validation surface)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = makeHarness(db)
      const run = (await (await app.request('/onboarding/start', { method: 'POST' })).json()) as {
        id: string
      }
      const res = await app.request(
        `/onboarding/${run.id}/submit`,
        jsonPost({ stepKind: 'not-a-real-step', stepInput: {} }),
      )
      expect(res.status).toBe(400)
    })
  })
})

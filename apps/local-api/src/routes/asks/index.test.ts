// Integration tests for the `/asks/...` routes — the answering surface of the
// ask_user blocking bridge. Full HTTP stack: route -> validator -> userScoped
// -> core op -> repo -> SQLite (real, via withTestDatabase), with an INJECTED
// waiter registry so the tests can assert the unblock half too.
//
// TENANT-ISOLATION ordering invariant: the Phase-1 resolver returns the FIRST
// user row, so the "attacker" is `insertUser`'d BEFORE the victim's rows.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { PendingAskRegistry, type AskOutcome } from '@vynel/asks'
import { seedUserWorkspace, makeAskRequest, insertAskRequest } from '@vynel/asks/test-support'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function jsonBody(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

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

describe('asks routes', () => {
  it('GET /pending lists only the pending asks, newest first', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      insertAskRequest(db, makeAskRequest(user.id, null))
      insertAskRequest(
        db,
        makeAskRequest(user.id, null, { status: 'answered', resolvedAt: new Date() }),
      )

      const res = await app.request('/asks/pending')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; questions: unknown[] }[]
      expect(body).toHaveLength(1)
      expect(body[0]!.status).toBe('pending')
      expect(body[0]!.questions).toHaveLength(3)
    })
  })

  it('POST /:askId/answer stores the answers AND unblocks the parked waiter (DB first)', async () => {
    await withTestDatabase(async (db) => {
      const askWaiters = new PendingAskRegistry()
      const app = createApp({ db, logger: silentLogger, askWaiters })
      const user = insertUser(db, makeUser())
      const ask = insertAskRequest(db, makeAskRequest(user.id, null))

      let outcome: AskOutcome | null = null
      askWaiters.register({
        askId: ask.id,
        userId: user.id,
        workspaceId: null,
        turnKey: 'turn-1',
        resolve: (resolved) => {
          outcome = resolved
        },
      })

      const res = await app.request(
        `/asks/${ask.id}/answer`,
        jsonBody('POST', { answers: { audience: 'Regulars', tone: 'Friendly' } }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; answers: Record<string, unknown> }
      expect(body.status).toBe('answered')
      expect(body.answers).toEqual({ audience: 'Regulars', tone: 'Friendly' })
      expect(outcome).toEqual({
        answered: true,
        answers: { audience: 'Regulars', tone: 'Friendly' },
      })
    })
  })

  it('POST /:askId/answer 400s on answers that do not fit (waiter stays parked)', async () => {
    await withTestDatabase(async (db) => {
      const askWaiters = new PendingAskRegistry()
      const app = createApp({ db, logger: silentLogger, askWaiters })
      const user = insertUser(db, makeUser())
      const ask = insertAskRequest(db, makeAskRequest(user.id, null))
      askWaiters.register({
        askId: ask.id,
        userId: user.id,
        workspaceId: null,
        turnKey: 'turn-1',
        resolve: () => {},
      })

      const res = await app.request(
        `/asks/${ask.id}/answer`,
        jsonBody('POST', { answers: { tone: 'Sarcastic' } }),
      )
      expect(res.status).toBe(400)
      expect(askWaiters.has(ask.id)).toBe(true) // a failed answer must not consume the waiter
    })
  })

  it('POST /:askId/dismiss resolves the waiter unanswered; a second resolve 409s', async () => {
    await withTestDatabase(async (db) => {
      const askWaiters = new PendingAskRegistry()
      const app = createApp({ db, logger: silentLogger, askWaiters })
      const user = insertUser(db, makeUser())
      const ask = insertAskRequest(db, makeAskRequest(user.id, null))

      let outcome: AskOutcome | null = null
      askWaiters.register({
        askId: ask.id,
        userId: user.id,
        workspaceId: null,
        turnKey: 'turn-1',
        resolve: (resolved) => {
          outcome = resolved
        },
      })

      const dismissed = await app.request(`/asks/${ask.id}/dismiss`, { method: 'POST' })
      expect(dismissed.status).toBe(200)
      expect(outcome).toEqual({ answered: false, reason: 'dismissed' })

      const again = await app.request(`/asks/${ask.id}/dismiss`, { method: 'POST' })
      expect(again.status).toBe(409)
    })
  })

  it("404s identically on a missing ask and another user's ask", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser()) // attacker — resolved as the local user
      const victim = seedUserWorkspace(db)
      const victimAsk = insertAskRequest(db, makeAskRequest(victim.userId, victim.workspaceId))

      const missing = await app.request(`/asks/${randomUUID()}/dismiss`, { method: 'POST' })
      const foreign = await app.request(`/asks/${victimAsk.id}/dismiss`, { method: 'POST' })
      expect(missing.status).toBe(404)
      expect(foreign.status).toBe(404)
    })
  })
})

// Integration tests for `GET /workspaces/:workspaceId/brief` — the stored
// wizard brief read back whole, null for a workspace the wizard did not
// make, and the owner-scoped 404 for a workspace that is not the user's.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace, insertWorkspaceBrief } from '@vynel/db/repositories/workspaces'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

type Db = Parameters<Parameters<typeof withTestDatabase>[0]>[0]

function seedUser(db: Db) {
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

function seedWorkspace(db: Db, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Front of House',
    managerName: null,
    kind: 'personal',
    path: `/work/${randomUUID()}`,
    groupId: null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

const ANSWERS = {
  idea: 'Book a table',
  audience: 'My customers',
  firstThing: 'Book',
  signIn: 'No, open to everyone',
  where: 'A website',
  remembers: ['Bookings'],
  wants: [],
  leftOut: [],
  changeRequests: [],
  goalNotes: [],
  stack: { front: 'Next.js', back: 'Next.js API routes', database: 'SQLite' },
}

const PLAN = {
  oneLine: 'A booking site.',
  build: [{ text: 'Let people book', source: 'your answers' }],
  remembers: ['Bookings'],
  leftOut: [],
  mvpNutshell: 'The smallest version worth using.',
  goals: [{ title: 'Book', bullets: ['One screen'] }],
  sessions: [{ name: 'Set up', items: ['First page'], mvp: true }],
}

describe('GET /workspaces/:workspaceId/brief', () => {
  it('returns the stored brief whole, with an ISO createdAt', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const createdAt = new Date('2026-08-23T10:00:00.000Z')
      insertWorkspaceBrief(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        answers: ANSWERS,
        plan: PLAN,
        brief: 'Build Front of House — the MVP first.',
        createdAt,
      })
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/brief`)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        brief: {
          workspaceId: workspace.id,
          answers: ANSWERS,
          plan: PLAN,
          brief: 'Build Front of House — the MVP first.',
          createdAt: createdAt.toISOString(),
        },
      })
    })
  })

  it('answers { brief: null } for a workspace the wizard did not make', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${workspace.id}/brief`)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ brief: null })
    })
  })

  it('404s for a workspace that does not exist (owner-scoped resolver)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${randomUUID()}/brief`)

      expect(res.status).toBe(404)
    })
  })
})

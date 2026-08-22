// Integration tests for `POST /workspaces/wizard/scaffold`. The core op is
// stubbed on the `@vynel/workspaces` barrel (it makes folders and shells out
// to git — covered at the leaf in `scaffold-workspace.test.ts`); what the
// route owns is proven here: the body validates, the resolved user rides in,
// optional fields stay absent rather than undefined, and the response is
// the serialized row + the git outcome + the brief.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { scaffoldWorkspace } from '@vynel/workspaces'
import type * as WorkspacesModule from '@vynel/workspaces'
import { createApp } from '../../app.js'

vi.mock('@vynel/workspaces', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspacesModule>()
  return { ...actual, scaffoldWorkspace: vi.fn() }
})

const mockScaffold = vi.mocked(scaffoldWorkspace)
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

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

beforeEach(() => {
  mockScaffold.mockReset()
})

describe('POST /workspaces/wizard/scaffold', () => {
  it('threads the body + the resolved user to the op and answers 201 with row, git outcome and brief', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const now = new Date()
      const row = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Front of House',
        managerName: 'Front of House',
        kind: 'personal',
        path: 'C:\\Users\\chad\\Projects\\Front of House',
        groupId: null,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      const createdAt = new Date('2026-08-23T10:00:00.000Z')
      mockScaffold.mockResolvedValue({
        workspace: row,
        git: { kind: 'initialized' },
        brief: {
          id: randomUUID(),
          userId: user.id,
          workspaceId: row.id,
          answers: ANSWERS,
          plan: PLAN,
          brief: 'Build Front of House — the MVP first.',
          createdAt,
        },
      })
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        '/workspaces/wizard/scaffold',
        postJson({
          name: 'Front of House',
          parentPath: 'C:\\Users\\chad\\Projects',
          answers: ANSWERS,
          plan: PLAN,
        }),
      )

      expect(res.status).toBe(201)
      const body = (await res.json()) as {
        workspace: { id: string; name: string }
        git: { kind: string }
        brief: { workspaceId: string; brief: string; createdAt: string }
      }
      expect(body.workspace.id).toBe(row.id)
      expect(body.workspace.name).toBe('Front of House')
      expect(body.git).toEqual({ kind: 'initialized' })
      expect(body.brief.workspaceId).toBe(row.id)
      expect(body.brief.brief).toBe('Build Front of House — the MVP first.')
      expect(body.brief.createdAt).toBe(createdAt.toISOString())

      expect(mockScaffold).toHaveBeenCalledTimes(1)
      const [, input, deps] = mockScaffold.mock.calls[0]!
      expect(input.userId).toBe(user.id)
      expect(input.name).toBe('Front of House')
      expect(input.parentPath).toBe('C:\\Users\\chad\\Projects')
      expect(input.answers).toEqual(ANSWERS)
      expect(input.plan).toEqual(PLAN)
      // Optional picks stay ABSENT — the op's own defaults apply.
      expect('folderName' in input).toBe(false)
      expect('groupId' in input).toBe(false)
      expect(deps?.logger).toBeDefined()
    })
  })

  it('passes folderName + groupId through when given', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const now = new Date()
      const row = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'X',
        managerName: 'X',
        kind: 'personal',
        path: '/work/x',
        groupId: 'grp-1',
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      mockScaffold.mockResolvedValue({
        workspace: row,
        git: { kind: 'skipped', reason: 'no git' },
        brief: {
          id: randomUUID(),
          userId: user.id,
          workspaceId: row.id,
          answers: ANSWERS,
          plan: PLAN,
          brief: 'x',
          createdAt: now,
        },
      })
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        '/workspaces/wizard/scaffold',
        postJson({
          name: 'X',
          parentPath: '/work',
          folderName: 'x-folder',
          groupId: 'grp-1',
          answers: ANSWERS,
          plan: PLAN,
        }),
      )

      expect(res.status).toBe(201)
      const body = (await res.json()) as { git: { kind: string; reason?: string } }
      expect(body.git).toEqual({ kind: 'skipped', reason: 'no git' })
      const [, input] = mockScaffold.mock.calls[0]!
      expect(input.folderName).toBe('x-folder')
      expect(input.groupId).toBe('grp-1')
    })
  })

  it('400s a body without a name — and never reaches the op', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        '/workspaces/wizard/scaffold',
        postJson({ parentPath: '/work', answers: ANSWERS, plan: PLAN }),
      )

      expect(res.status).toBe(400)
      expect(mockScaffold).not.toHaveBeenCalled()
    })
  })
})

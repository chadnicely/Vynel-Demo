// Integration tests for `POST /workspaces/wizard/clone`. The core op is
// stubbed on the `@vynel/workspaces` barrel (it shells out to git — covered at
// the leaf in `clone-repository-workspace.test.ts`); what the route owns is
// proven here: the body validates, the resolved user rides in, an optional
// field stays absent, and the response is the serialized row.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { cloneRepositoryWorkspace } from '@vynel/workspaces'
import type * as WorkspacesModule from '@vynel/workspaces'
import { createApp } from '../../app.js'

vi.mock('@vynel/workspaces', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspacesModule>()
  return { ...actual, cloneRepositoryWorkspace: vi.fn() }
})

const mockClone = vi.mocked(cloneRepositoryWorkspace)
const silentLogger = pino({ level: 'silent' })

type Db = Parameters<Parameters<typeof withTestDatabase>[0]>[0]

const FOLDER = 'C:\\Users\\chad\\Projects\\Pricing'

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

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

beforeEach(() => {
  mockClone.mockReset()
})

describe('POST /workspaces/wizard/clone', () => {
  it('threads the body + the resolved user to the op and answers 201 with the row', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const now = new Date()
      const row = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Pricing',
        managerName: 'Pricing',
        kind: 'personal',
        path: FOLDER,
        groupId: null,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      mockClone.mockResolvedValue({ workspace: row })
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        '/workspaces/wizard/clone',
        postJson({
          name: 'Pricing',
          directory: FOLDER,
          repositoryUrl: 'https://github.com/acme/pricing.git',
        }),
      )

      expect(res.status).toBe(201)
      const body = (await res.json()) as { workspace: { id: string; name: string } }
      expect(body.workspace.id).toBe(row.id)
      expect(body.workspace.name).toBe('Pricing')

      const [, input, deps] = mockClone.mock.calls[0]!
      expect(input.userId).toBe(user.id)
      expect(input.repositoryUrl).toBe('https://github.com/acme/pricing.git')
      expect(input.directory).toBe(FOLDER)
      expect('groupId' in input).toBe(false)
      expect(deps?.logger).toBeDefined()
    })
  })

  it('400s a body without an address — and never reaches the op', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(
        '/workspaces/wizard/clone',
        postJson({ name: 'Pricing', directory: FOLDER }),
      )

      expect(res.status).toBe(400)
      expect(mockClone).not.toHaveBeenCalled()
    })
  })
})

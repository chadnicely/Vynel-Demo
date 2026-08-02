// Integration tests for the USER-scoped `/skills/installed` route — the
// GLOBAL Skills view's anchor. Full HTTP stack over the product SQLite +
// real disk (home isolated via the skills host-home seam). The point of the
// route is what it does NOT return: workspace-scope installs.

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { withHomeDir } from '@vynel/skills/test-support'
import type { Database } from '@vynel/db'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedWorld(db: Database, workspacePath: string) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: true,
    createdAt: now,
    updatedAt: now,
  })
  return insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Bakery',
    kind: 'small-business',
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

describe('user-scoped skills routes', () => {
  it('GET /installed lists ONLY user-scope installs (never a workspace row)', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'vynel-skills-user-home-'))
    const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-skills-user-ws-'))
    try {
      await withTestDatabase(async (db) => {
        const workspace = seedWorld(db, workspaceDir)
        const app = createApp({ db, logger: silentLogger })
        await withHomeDir(homeDir, async () => {
          // Install through the real workspace surface: one at each scope.
          const installUser = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skillId: 'email-drafter', scope: 'user' }),
          })
          expect(installUser.status).toBe(201)
          const installWorkspace = await app.request(
            `/workspaces/${workspace.id}/skills/install`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ skillId: 'email-drafter', scope: 'workspace' }),
            },
          )
          expect(installWorkspace.status).toBe(201)

          const res = await app.request('/skills/installed')
          expect(res.status).toBe(200)
          const rows = (await res.json()) as {
            scope: string
            workspaceId: string | null
            definition: { displayName: string } | null
          }[]
          expect(rows).toHaveLength(1)
          expect(rows[0]).toMatchObject({ scope: 'user', workspaceId: null })
          expect(rows[0]!.definition?.displayName).toBe('Email Drafter')
        })
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })

  it('GET /installed answers empty when nothing is installed', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'vynel-skills-user-home2-'))
    try {
      await withTestDatabase(async (db) => {
        seedWorld(db, join(tmpdir(), `vynel-skills-user-ws2-${randomUUID()}`))
        const app = createApp({ db, logger: silentLogger })
        await withHomeDir(homeDir, async () => {
          const res = await app.request('/skills/installed')
          expect(res.status).toBe(200)
          expect(await res.json()).toEqual([])
        })
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})

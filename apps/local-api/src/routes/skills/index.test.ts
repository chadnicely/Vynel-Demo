// Integration tests for the `/workspaces/:workspaceId/skills/...`
// routes. Full HTTP stack (route → workspaceScoped → core op → repo
// → SQLite). FS-touching core ops write into per-test tmpdirs — the
// workspace dir (workspace-scope installs) AND a redirected host home
// dir (user-scope installs), so a test run never touches the dev's
// real `~/.claude/skills/`. See `withIsolatedFs`.
//
// `/synchronize` is deliberately NOT tested here — the route calls
// `resolveAiAgentProvider('claude')` which would read the dev's
// real `~/.claude/skills/` directory at test time
// (non-deterministic). The core-op level
// (`synchronize-skills-with-provider.test.ts`) covers the
// behavior with an injected fake provider.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { SKILL_INSTALLED } from '@vynel/skills'
import { withHomeDir } from '@vynel/skills/test-support'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedWorld(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  workspacePath: string,
) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

// Isolate BOTH the workspace dir (workspace-scope installs write under
// `<workspacePath>/.claude/skills/`) AND the host home dir (user-scope
// installs write under `~/.claude/skills/`) to per-test tmpdirs. The
// route tests drive real installs through the HTTP stack, so without the
// `withHomeDir` seam a user-scope install would clobber/delete the dev's
// real `~/.claude/skills/email-drafter/`. `withHomeDir` is process-global
// within the vitest worker, so it correctly redirects the install that
// runs route → installSkill → resolveHostHomeDir.
async function withIsolatedFs<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-skills-routes-test-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-skills-home-'))
  try {
    return await withHomeDir(homeDir, () => fn(workspaceDir))
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

describe('skills routes', () => {
  describe('GET /skills/available', () => {
    it('returns the Verified catalog as JSON', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/skills/available`)
          expect(res.status).toBe(200)
          const body = (await res.json()) as unknown[]
          expect(Array.isArray(body)).toBe(true)
          // Phase 1 catalog ships 1 entry (email-drafter); workspace-context retired in A2.
          expect(body.length).toBe(1)
          const ids = body.map((s) => (s as { skillId: string }).skillId).sort()
          expect(ids).toEqual(['email-drafter'])
        })
      })
    })
  })

  describe('GET /skills/installed', () => {
    it('returns empty array when nothing is installed', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/skills/installed`)
          expect(res.status).toBe(200)
          expect(await res.json()).toEqual([])
        })
      })
    })

    it('returns the installed list after POST /install', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const installRes = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skillId: 'email-drafter', scope: 'user' }),
          })
          expect(installRes.status).toBe(201)

          const listRes = await app.request(`/workspaces/${workspace.id}/skills/installed`)
          const list = (await listRes.json()) as Array<{
            skillId: string
            resolvedSettings: Record<string, unknown>
          }>
          expect(list).toHaveLength(1)
          expect(list[0]!.skillId).toBe('email-drafter')
          // The catalog defaults should be reflected in resolvedSettings.
          expect(list[0]!.resolvedSettings.defaultSignOff).toBe('Best,')
          expect(list[0]!.resolvedSettings.tonePreference).toBe('professional')
        })
      })
    })
  })

  describe('POST /skills/install', () => {
    it('returns 201 with the installed-skill row + emits skill.installed outbox event', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const res = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              skillId: 'email-drafter',
              scope: 'workspace',
              initialSettings: { defaultSignOff: 'Cheers,' },
            }),
          })
          expect(res.status).toBe(201)
          const installed = (await res.json()) as { id: string; scope: string }
          expect(installed.scope).toBe('workspace')

          const events = listOutboxEventsByType(db, SKILL_INSTALLED)
          expect(events).toHaveLength(1)
        })
      })
    })

    it('returns 404 for an unknown skill (NotFoundError mapping)', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skillId: 'no-such-skill', scope: 'user' }),
          })
          expect(res.status).toBe(404)
          const body = (await res.json()) as { code: string }
          expect(body.code).toBe('not_found')
        })
      })
    })

    it('returns 409 when re-installing at the same scope', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          // First call should succeed; second call returns 409.
          const first = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skillId: 'email-drafter', scope: 'user' }),
          })
          expect(first.status).toBe(201)

          const second = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skillId: 'email-drafter', scope: 'user' }),
          })
          expect(second.status).toBe(409)
          const body = (await second.json()) as { code: string }
          expect(body.code).toBe('conflict')
        })
      })
    })

    it('returns 400 for an invalid initial setting', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              skillId: 'email-drafter',
              scope: 'user',
              initialSettings: { tonePreference: 'angry' }, // not in enum
            }),
          })
          expect(res.status).toBe(400)
        })
      })
    })
  })
})

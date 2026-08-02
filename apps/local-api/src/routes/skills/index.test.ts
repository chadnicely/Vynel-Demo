// Integration tests for the `/workspaces/:workspaceId/skills/...`
// routes. Full HTTP stack (route → workspaceScoped → core op → repo
// → SQLite). FS-touching core ops write into per-test tmpdirs — the
// workspace dir (workspace-scope installs) AND a redirected host home
// dir (user-scope installs), so a test run never touches the dev's
// real `~/.claude/skills/`. See `withIsolatedFs`.
//
// `/synchronize` IS tested here now — the route reads `c.var.aiProvider`
// (injected via `createApp({ aiProvider })`), so a test threads a FAKE
// provider through the whole HTTP stack instead of the route hardcoding
// `resolveAiAgentProvider('claude')` (which would read the dev's real
// `~/.claude/skills/` at test time). The core-op level
// (`synchronize-skills-with-provider.test.ts`) covers the reconciliation
// branches; this asserts the route wires the injected provider through.

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
import type { AiAgentProvider } from '@vynel/providers'
import { createApp } from '../../app.js'

// A fake provider — only `discoverInstalledSkills` is exercised by the
// synchronize op; the rest throw to signal misuse (mirrors the core-op test's
// `makeFakeProvider`). Returning a fixed external skill proves the FAKE was
// threaded: a real provider under `withHomeDir` isolation would see nothing.
function makeFakeProvider(
  skills: Awaited<ReturnType<AiAgentProvider['discoverInstalledSkills']>>,
): AiAgentProvider {
  return {
    providerId: 'claude' as const,
    discoverInstalledSkills: async () => skills,
    getAuthenticationStatus: async () => {
      throw new Error('not used in synchronize route test')
    },
    listConfiguredMcpServers: async () => [],
    startChatSession: () => {
      throw new Error('not used')
    },
    respondToApprovalRequest: async () => {
      throw new Error('not used')
    },
    interruptChatSession: async () => {
      throw new Error('not used')
    },
    fetchPersistedSessionTranscript: async () => {
      throw new Error('not used')
    },
    synchronizePersistedSessions: async () => [],
    getContextReport: async () => null,
    summarizeSession: async () => null,
    summarizeReport: async () => null,
  } as AiAgentProvider
}

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

    // SPEC CHANGE (2026-08-03): `/installed` is the MENU's read — what this
    // workspace OWNS — so a user-scope install belongs to the Global menu and
    // no longer appears here. `/installed/resolved` is what a session can
    // actually reach, and is what Claude's `list_installed_skills` reads.
    it('lists a workspace-scope install, not a user-scope one', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const install = (scope: string) =>
            app.request(`/workspaces/${workspace.id}/skills/install`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ skillId: 'email-drafter', scope }),
            })
          expect((await install('user')).status).toBe(201)

          const userOnly = await app.request(`/workspaces/${workspace.id}/skills/installed`)
          expect((await userOnly.json()) as unknown[]).toEqual([])

          expect((await install('workspace')).status).toBe(201)
          const listRes = await app.request(`/workspaces/${workspace.id}/skills/installed`)
          const list = (await listRes.json()) as Array<{ skillId: string; scope: string }>
          expect(list.map((row) => [row.skillId, row.scope])).toEqual([
            ['email-drafter', 'workspace'],
          ])
        })
      })
    })

    it('returns the resolved union after POST /install', async () => {
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

          const listRes = await app.request(
            `/workspaces/${workspace.id}/skills/installed/resolved`,
          )
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

  describe('POST /skills/synchronize', () => {
    it('reconciles against the INJECTED fake provider (not the real claude runtime)', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          // The fake sees ONE external skill not in our DB. A real provider under
          // `withHomeDir` isolation would see nothing → externalDiscoveredCount 0,
          // so a count of 1 proves the injected fake was threaded through the route.
          const app = createApp({
            db,
            logger: silentLogger,
            aiProvider: makeFakeProvider([
              {
                providerId: 'claude',
                scope: 'user',
                skillName: 'random-cli-skill',
                displayDescription: 'installed via raw Claude Code',
                installLocation: '/external/path/random-cli-skill/SKILL.md',
                invocationSyntax: '/random-cli-skill',
              },
            ]),
          })

          const res = await app.request(`/workspaces/${workspace.id}/skills/synchronize`, {
            method: 'POST',
          })
          expect(res.status).toBe(200)
          const stats = (await res.json()) as {
            healthyCount: number
            missingOnDiskCount: number
            externalDiscoveredCount: number
          }
          expect(stats).toEqual({
            healthyCount: 0,
            missingOnDiskCount: 0,
            externalDiscoveredCount: 1,
          })
        })
      })
    })
  })
})

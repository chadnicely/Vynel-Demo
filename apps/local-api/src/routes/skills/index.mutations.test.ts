// Integration tests for the MUTATING `/workspaces/:workspaceId/skills/...`
// routes (DELETE / PATCH settings). The GET + POST /install routes live
// in `index.test.ts`. Split per structure-standard.md "File size cap"
// (code-reviewer C1).
//
// User-scope installs are redirected to a per-test tmp home dir via
// `withIsolatedFs` — uninstall DELETES the on-disk skill folder, so
// without the home seam these would wipe the dev's real
// `~/.claude/skills/email-drafter/`.

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
import { SKILL_UNINSTALLED } from '@vynel/skills'
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

// Isolate the workspace dir + host home dir to per-test tmpdirs so
// user-scope installs (and the uninstall deletes they trigger) never
// touch the dev's real `~/.claude/skills/`. See the companion note
// in `index.test.ts`.
async function withIsolatedFs<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-skills-routes-mut-test-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-skills-home-'))
  try {
    return await withHomeDir(homeDir, () => fn(workspaceDir))
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

describe('skills routes — mutations', () => {
  describe('DELETE /skills/installed/:id', () => {
    it('returns 204 + emits skill.uninstalled', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const installRes = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skillId: 'email-drafter', scope: 'user' }),
          })
          const installed = (await installRes.json()) as { id: string }

          const delRes = await app.request(
            `/workspaces/${workspace.id}/skills/installed/${installed.id}`,
            { method: 'DELETE' },
          )
          expect(delRes.status).toBe(204)

          const events = listOutboxEventsByType(db, SKILL_UNINSTALLED)
          expect(events).toHaveLength(1)
        })
      })
    })

    it('returns 404 for a nonexistent installed-skill id', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })
          const res = await app.request(
            `/workspaces/${workspace.id}/skills/installed/nonexistent`,
            { method: 'DELETE' },
          )
          expect(res.status).toBe(404)
        })
      })
    })
  })

  describe('PATCH /skills/installed/:id/settings', () => {
    it('returns the resolved settings on success', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const installRes = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skillId: 'email-drafter', scope: 'user' }),
          })
          const installed = (await installRes.json()) as { id: string }

          const patchRes = await app.request(
            `/workspaces/${workspace.id}/skills/installed/${installed.id}/settings`,
            {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                newSettings: { defaultSignOff: 'Best regards,' },
              }),
            },
          )
          expect(patchRes.status).toBe(200)
          const resolved = (await patchRes.json()) as Record<string, unknown>
          expect(resolved.defaultSignOff).toBe('Best regards,')
          expect(resolved.tonePreference).toBe('professional') // default preserved
        })
      })
    })

    it('returns 400 on an unknown setting key', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger })

          const installRes = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skillId: 'email-drafter', scope: 'user' }),
          })
          const installed = (await installRes.json()) as { id: string }

          const patchRes = await app.request(
            `/workspaces/${workspace.id}/skills/installed/${installed.id}/settings`,
            {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ newSettings: { orphan: 'x' } }),
            },
          )
          expect(patchRes.status).toBe(400)
        })
      })
    })
  })
})

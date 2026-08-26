// The `/agents/files` trio over the full HTTP stack — real temp home dir
// (agents host-home seam) + temp workspace dir + real SQLite. Under guard:
// the list fuses the user folder with a workspace's and never shows a
// Vynel mirror, PUT validates a loadable file and refuses a slug Vynel owns,
// DELETE removes the file / refuses a mirror / 404s, and — the reason the
// trio exists — a user-built agent now lands on disk as a mirror too.

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { withHomeDir } from '@vynel/agents/test-support'
import type { Database } from '@vynel/db'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })
const HAND_MADE = '---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\n---\n\nReview carefully.\n'

type AgentFileRow = { slug: string; scope: string; name: string; body: string }

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

async function withWorld<T>(
  fn: (ctx: {
    app: ReturnType<typeof createApp>
    homeDir: string
    workspaceDir: string
    workspaceId: string
  }) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-agent-files-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-agent-files-ws-'))
  try {
    return await withTestDatabase(async (db) => {
      const workspace = seedWorld(db, workspaceDir)
      const app = createApp({ db, logger: silentLogger })
      return withHomeDir(homeDir, () =>
        fn({ app, homeDir, workspaceDir, workspaceId: workspace.id }),
      )
    })
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

function jsonRequest(method: 'POST' | 'PUT', body: unknown) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

describe('GET /agents/files', () => {
  it('fuses the user folder with the workspace\'s and hides Vynel mirrors', async () => {
    await withWorld(async ({ app, homeDir, workspaceDir, workspaceId }) => {
      mkdirSync(join(homeDir, '.claude', 'agents'), { recursive: true })
      writeFileSync(join(homeDir, '.claude', 'agents', 'reviewer.md'), HAND_MADE, 'utf8')
      mkdirSync(join(workspaceDir, '.claude', 'agents'), { recursive: true })
      writeFileSync(
        join(workspaceDir, '.claude', 'agents', 'room-only.md'),
        HAND_MADE.replace('name: reviewer', 'name: room-only'),
        'utf8',
      )
      // A user-built Vynel agent lands on disk as a mirror — and never in this list.
      const created = await app.request(
        '/agents',
        jsonRequest('POST', {
          slug: 'planner',
          name: 'Planner',
          description: 'Plans',
          prompt: 'You plan.',
          scope: 'workspace',
          workspaceId,
        }),
      )
      expect(created.status).toBe(201)
      const mirror = join(workspaceDir, '.claude', 'agents', 'planner.md')
      expect(readFileSync(mirror, 'utf8')).toContain('Managed by Vynel')

      const fused = await app.request(`/agents/files?workspaceId=${workspaceId}`)
      expect(fused.status).toBe(200)
      const { agentFiles } = (await fused.json()) as { agentFiles: AgentFileRow[] }
      expect(agentFiles.map((row) => [row.slug, row.scope])).toEqual([
        ['reviewer', 'user'],
        ['room-only', 'workspace'],
      ])
      expect(agentFiles[0]).toMatchObject({ name: 'reviewer', body: 'Review carefully.\n' })

      const userOnly = (await (await app.request('/agents/files')).json()) as {
        agentFiles: AgentFileRow[]
      }
      expect(userOnly.agentFiles.map((row) => row.slug)).toEqual(['reviewer'])
      expect((await app.request(`/agents/files?workspaceId=${randomUUID()}`)).status).toBe(404)
    })
  })
})

describe('PUT + DELETE /agents/files/:slug', () => {
  it('writes, replaces, refuses a Vynel-owned slug, deletes, and 404s once gone', async () => {
    await withWorld(async ({ app, homeDir, workspaceId }) => {
      const written = await app.request(
        '/agents/files/reviewer',
        jsonRequest('PUT', { scope: 'user', content: HAND_MADE }),
      )
      expect(written.status).toBe(200)
      expect(await written.json()).toMatchObject({ slug: 'reviewer', scope: 'user', name: 'reviewer' })
      expect(existsSync(join(homeDir, '.claude', 'agents', 'reviewer.md'))).toBe(true)

      expect(
        (await app.request('/agents/files/reviewer', jsonRequest('PUT', { scope: 'user', content: 'no frontmatter' })))
          .status,
      ).toBe(400)
      expect(
        (await app.request('/agents/files/reviewer', jsonRequest('PUT', { scope: 'workspace', content: HAND_MADE })))
          .status,
      ).toBe(400)

      await app.request(
        '/agents',
        jsonRequest('POST', {
          slug: 'planner',
          name: 'Planner',
          description: 'Plans',
          prompt: 'You plan.',
          scope: 'user',
        }),
      )
      const collision = await app.request(
        '/agents/files/planner',
        jsonRequest('PUT', { scope: 'user', content: HAND_MADE.replace('name: reviewer', 'name: planner') }),
      )
      expect(collision.status).toBe(409)
      const mirrorDelete = await app.request('/agents/files/planner?scope=user', { method: 'DELETE' })
      expect(mirrorDelete.status).toBe(409)

      const deleted = await app.request('/agents/files/reviewer?scope=user', { method: 'DELETE' })
      expect(deleted.status).toBe(204)
      expect(existsSync(join(homeDir, '.claude', 'agents', 'reviewer.md'))).toBe(false)
      expect((await app.request('/agents/files/reviewer?scope=user', { method: 'DELETE' })).status).toBe(404)
      expect(
        (await app.request(`/agents/files/reviewer?scope=workspace&workspaceId=${workspaceId}`, { method: 'DELETE' }))
          .status,
      ).toBe(404)
    })
  })
})

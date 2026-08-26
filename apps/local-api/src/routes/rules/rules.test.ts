// Integration tests for BOTH `rules` twins — full HTTP stack over a real
// temp home dir (skills host-home seam) + temp workspace dir. Under guard:
// the UNFILTERED read (hand-written files appear — the marketplace-filtered
// reader must not leak into this surface), per-row provenance, and the
// user ∪ workspace fusion with scope chips on the workspace twin.

import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

async function withWorld<T>(
  fn: (ctx: {
    app: ReturnType<typeof createApp>
    homeDir: string
    workspaceDir: string
    workspaceId: string
  }) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-rules-routes-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-rules-routes-ws-'))
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

describe('user-scoped /rules', () => {
  it('lists hand-written AND marketplace rules with provenance per row', async () => {
    await withWorld(async ({ app, homeDir }) => {
      const rulesDir = join(homeDir, '.claude', 'rules')
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'my-style.md'), '# My style\n\nBe brief.\n', 'utf8')
      writeFileSync(
        join(rulesDir, 'git-hygiene.md'),
        '<!-- vynel-marketplace-rule: git-hygiene v2.1.0 -->\n\n# Git hygiene\n\nSmall commits.\n',
        'utf8',
      )

      const res = await app.request('/rules')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { rules: Record<string, unknown>[] }
      expect(body.rules).toEqual([
        {
          ruleId: 'git-hygiene',
          fileName: 'git-hygiene.md',
          title: 'Git hygiene',
          content: expect.stringContaining('Small commits.') as unknown,
          body: '# Git hygiene\n\nSmall commits.\n',
          scope: 'user',
          marketplace: { ruleId: 'git-hygiene', version: '2.1.0' },
        },
        {
          ruleId: 'my-style',
          fileName: 'my-style.md',
          title: 'My style',
          content: expect.stringContaining('Be brief.') as unknown,
          body: '# My style\n\nBe brief.\n',
          scope: 'user',
          marketplace: null,
        },
      ])
    })
  })

  it('answers an empty list when the folder does not exist', async () => {
    await withWorld(async ({ app }) => {
      const res = await app.request('/rules')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ rules: [] })
    })
  })
})

describe('workspace-scoped /workspaces/:workspaceId/rules', () => {
  // SPEC CHANGE (2026-08-03): the menu mirrors the folder on disk, so a
  // user-level rule is no longer listed under a workspace — the Global menu
  // owns it. (It still APPLIES to a session here; nothing about resolution
  // changed.) No composer picker reads rules, so there is no /resolved twin.
  it('lists only the workspace’s own rules', async () => {
    await withWorld(async ({ app, homeDir, workspaceDir, workspaceId }) => {
      const userRules = join(homeDir, '.claude', 'rules')
      const wsRules = join(workspaceDir, '.claude', 'rules')
      mkdirSync(userRules, { recursive: true })
      mkdirSync(wsRules, { recursive: true })
      writeFileSync(join(userRules, 'global-rule.md'), '# Global rule\n', 'utf8')
      writeFileSync(join(wsRules, 'room-rule.md'), '# Room rule\n', 'utf8')

      const res = await app.request(`/workspaces/${workspaceId}/rules`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { rules: { ruleId: string; scope: string }[] }
      expect(body.rules.map((rule) => [rule.ruleId, rule.scope])).toEqual([
        ['room-rule', 'workspace'],
      ])
    })
  })

  it('404s an unknown workspace', async () => {
    await withWorld(async ({ app }) => {
      expect((await app.request(`/workspaces/${randomUUID()}/rules`)).status).toBe(404)
    })
  })
})

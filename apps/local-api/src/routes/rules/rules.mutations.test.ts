// The `/rules` write doors over the full HTTP stack — real temp home dir
// (skills host-home seam) + temp workspace dir + real SQLite. Under guard:
// PUT creates and replaces at both scopes, saving over a marketplace rule
// forks it (marker gone), DELETE removes any named file and 404s on a
// missing one, the scope ↔ workspaceId pairing (400 / 404), the safe-name
// wall (400), and the resolved read a workspace session sees.

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { withHomeDir } from '@vynel/skills/test-support'
import { installRuleFileForScope } from '@vynel/skills'
import type { Database } from '@vynel/db'
import { createApp } from '../../app.js'
import type { RuleRow } from './serializers.js'

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
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-rules-mut-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-rules-mut-ws-'))
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

function putRule(app: ReturnType<typeof createApp>, ruleId: string, body: unknown) {
  return app.request(`/rules/${encodeURIComponent(ruleId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /rules/:ruleId', () => {
  it("creates a user-scope rule and reads it back as the user's own", async () => {
    await withWorld(async ({ app, homeDir }) => {
      const response = await putRule(app, 'git-hygiene', {
        scope: 'user',
        content: '# Git hygiene\n\nSmall commits.',
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        ruleId: 'git-hygiene',
        fileName: 'git-hygiene.md',
        title: 'Git hygiene',
        scope: 'user',
        marketplace: null,
      })
      expect(readFileSync(join(homeDir, '.claude', 'rules', 'git-hygiene.md'), 'utf8')).toBe(
        '# Git hygiene\n\nSmall commits.\n',
      )
    })
  })

  it('writes into the workspace folder for the workspace scope and replaces on a second PUT', async () => {
    await withWorld(async ({ app, workspaceDir, workspaceId }) => {
      await putRule(app, 'tone', {
        scope: 'workspace',
        workspaceId,
        content: 'Be warm.',
      })
      const second = await putRule(app, 'tone', {
        scope: 'workspace',
        workspaceId,
        content: 'Be warm and brief.',
      })
      expect(second.status).toBe(200)
      expect(((await second.json()) as RuleRow).scope).toBe('workspace')
      expect(readFileSync(join(workspaceDir, '.claude', 'rules', 'tone.md'), 'utf8')).toBe(
        'Be warm and brief.\n',
      )
    })
  })

  it('the user scope ignores an ambient workspaceId; the workspace scope requires one', async () => {
    await withWorld(async ({ app, homeDir, workspaceDir, workspaceId }) => {
      const stamped = await putRule(app, 'global-tone', {
        scope: 'user',
        workspaceId,
        content: 'Everywhere.',
      })
      expect(stamped.status).toBe(200)
      expect(existsSync(join(homeDir, '.claude', 'rules', 'global-tone.md'))).toBe(true)
      expect(existsSync(join(workspaceDir, '.claude', 'rules', 'global-tone.md'))).toBe(false)

      const missing = await putRule(app, 'room', {
        scope: 'workspace',
        content: 'x',
      })
      expect(missing.status).toBe(400)
      const foreign = await putRule(app, 'room', {
        scope: 'workspace',
        workspaceId: randomUUID(),
        content: 'x',
      })
      expect(foreign.status).toBe(404)
    })
  })

  it('refuses an unsafe name with 400 and never touches disk', async () => {
    await withWorld(async ({ app, homeDir }) => {
      const response = await putRule(app, '..escape', {
        scope: 'user',
        content: 'x',
      })
      expect(response.status).toBe(400)
      expect(existsSync(join(homeDir, '.claude', 'rules'))).toBe(false)
    })
  })

  it('saving over a marketplace rule forks it — the marker goes', async () => {
    await withWorld(async ({ app }) => {
      await installRuleFileForScope({
        scope: 'user',
        ruleId: 'conventional-commits',
        version: '1.0.0',
        ruleMarkdown: '# Conventional Commits',
      })
      const response = await putRule(app, 'conventional-commits', {
        scope: 'user',
        content:
          '<!-- vynel-marketplace-rule: conventional-commits v1.0.0 -->\n\n# Conventional Commits\n\nMine now.',
      })
      expect(response.status).toBe(200)
      const row = (await response.json()) as RuleRow
      expect(row.marketplace).toBeNull()
      expect(row.content.startsWith('# Conventional Commits')).toBe(true)
    })
  })
})

describe('DELETE /rules/:ruleId', () => {
  it('removes a hand-written file, 404s once it is gone', async () => {
    await withWorld(async ({ app, homeDir }) => {
      const rulesDir = join(homeDir, '.claude', 'rules')
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'mine.md'), '# Mine\n', 'utf8')

      const first = await app.request('/rules/mine?scope=user', {
        method: 'DELETE',
      })
      expect(first.status).toBe(204)
      expect(existsSync(join(rulesDir, 'mine.md'))).toBe(false)

      const second = await app.request('/rules/mine?scope=user', {
        method: 'DELETE',
      })
      expect(second.status).toBe(404)
    })
  })

  it('deletes in the workspace folder when asked for that scope', async () => {
    await withWorld(async ({ app, workspaceDir, workspaceId }) => {
      await putRule(app, 'room', {
        scope: 'workspace',
        workspaceId,
        content: 'Room.',
      })
      const response = await app.request(`/rules/room?scope=workspace&workspaceId=${workspaceId}`, {
        method: 'DELETE',
      })
      expect(response.status).toBe(204)
      expect(existsSync(join(workspaceDir, '.claude', 'rules', 'room.md'))).toBe(false)
    })
  })
})

describe('GET /rules/resolved', () => {
  it("fuses the user folder with the workspace's, scope per row; user-only when omitted", async () => {
    await withWorld(async ({ app, workspaceId }) => {
      await putRule(app, 'global-tone', {
        scope: 'user',
        content: 'Everywhere.',
      })
      await putRule(app, 'room', {
        scope: 'workspace',
        workspaceId,
        content: 'Here.',
      })

      const fused = await app.request(`/rules/resolved?workspaceId=${workspaceId}`)
      expect(fused.status).toBe(200)
      const { rules } = (await fused.json()) as { rules: RuleRow[] }
      expect(rules.map((rule) => [rule.ruleId, rule.scope])).toEqual([
        ['global-tone', 'user'],
        ['room', 'workspace'],
      ])

      const userOnly = await app.request('/rules/resolved')
      const userRules = ((await userOnly.json()) as { rules: RuleRow[] }).rules
      expect(userRules.map((rule) => rule.ruleId)).toEqual(['global-tone'])

      const foreign = await app.request(`/rules/resolved?workspaceId=${randomUUID()}`)
      expect(foreign.status).toBe(404)
    })
  })
})

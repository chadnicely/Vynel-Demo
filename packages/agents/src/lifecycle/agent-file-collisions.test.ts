// The collision story between Vynel agents (rows + mirrors) and the user's
// hand-authored files, on every door: a create refuses a hand-authored file
// even when the row would start disabled, a slug rename refuses a hand-
// authored file at the new path, a hand-authored file whose prompt merely
// mentions the marker phrase is NOT a mirror, and the row op stays disk-free.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { isAgentMirrorMarkdown } from '../internal/render-agent-mirror-markdown.js'
import { listFileAgentsForScope } from '../files/list-file-agents-for-scope.js'
import { createAgent } from './create-agent.js'
import { updateAgent } from './update-agent.js'
import type { CreateAgentInput } from './create-agent-row.js'

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: true,
    createdAt: now,
    updatedAt: now,
  })
}

function baseInput(userId: string, overrides: Partial<CreateAgentInput> = {}): CreateAgentInput {
  return {
    userId,
    workspaceId: null,
    slug: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews',
    prompt: 'Review.',
    source: 'user',
    trustTier: 'community',
    ...overrides,
  }
}

const HAND_MADE =
  '---\nname: reviewer\ndescription: Reviews code\n---\n\nSkip any file marked Managed by Vynel.\n'

async function withIsolatedHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-agent-collisions-'))
  try {
    return await withHomeDir(homeDir, () => fn(homeDir))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
  }
}

describe('agent ↔ file collisions', () => {
  it('a hand-authored file mentioning the marker phrase is still the user\'s own', async () => {
    await withIsolatedHome(async (homeDir) => {
      const agentsDir = join(homeDir, '.claude', 'agents')
      mkdirSync(agentsDir, { recursive: true })
      writeFileSync(join(agentsDir, 'reviewer.md'), HAND_MADE, 'utf8')
      expect(isAgentMirrorMarkdown(HAND_MADE)).toBe(false)
      expect(listFileAgentsForScope('user').map((file) => file.slug)).toEqual(['reviewer'])

      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        // Enabled AND disabled creates refuse it — before any row exists.
        await expect(createAgent(db, baseInput(user.id))).rejects.toMatchObject({ code: 'conflict' })
        await expect(createAgent(db, baseInput(user.id, { enabled: false }))).rejects.toMatchObject({
          code: 'conflict',
        })
        expect(readFileSync(join(agentsDir, 'reviewer.md'), 'utf8')).toBe(HAND_MADE)
      })
    })
  })

  it('a slug rename refuses a hand-authored file at the new path and leaves the row alone', async () => {
    await withIsolatedHome(async (homeDir) => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const agent = await createAgent(db, baseInput(user.id, { slug: 'planner', name: 'Planner' }))
        const agentsDir = join(homeDir, '.claude', 'agents')
        writeFileSync(join(agentsDir, 'reviewer.md'), HAND_MADE, 'utf8')

        await expect(
          updateAgent(db, { agentId: agent.id, userId: user.id, slug: 'reviewer' }),
        ).rejects.toMatchObject({ code: 'conflict' })
        expect(readFileSync(join(agentsDir, 'reviewer.md'), 'utf8')).toBe(HAND_MADE)
        expect(isAgentMirrorMarkdown(readFileSync(join(agentsDir, 'planner.md'), 'utf8'))).toBe(true)
      })
    })
  })
})

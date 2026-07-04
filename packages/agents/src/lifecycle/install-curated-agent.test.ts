// Integration tests for `installCuratedAgent` — the curated-seed install
// path. Real SQLite via `withTestDatabase` (no mocking). Exercises the
// real CURATED_AGENT_CATALOG end-to-end (catalog → row → resolved
// AgentDefinition). Spec: `docs/agent-base/agents.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listSkillIdsForAgent } from '@vynel/db/repositories/agents'
import { NotFoundError } from '@vynel/errors'
import { installCuratedAgent } from './install-curated-agent.js'
import { resolveEnabledAgentsForSession } from '../session/resolve-enabled-agents-for-session.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('installCuratedAgent', () => {
  it('installs document-generator as a vynel/verified, enabled, user-scope row', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await installCuratedAgent(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'document-generator',
      })

      expect(agent.source).toBe('vynel')
      expect(agent.trustTier).toBe('verified')
      expect(agent.enabled).toBe(true)
      expect(agent.scope).toBe('user')
      expect(agent.allowedTools).toEqual(['Read', 'Write', 'Edit', 'Glob'])
    })
  })

  it('installs inbox-assistant with its preloaded email-drafter skill', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await installCuratedAgent(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'inbox-assistant',
      })
      expect(listSkillIdsForAgent(db, agent.id)).toEqual(['email-drafter'])
    })
  })

  it('installs researcher with the sonnet model', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await installCuratedAgent(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'researcher',
      })
      expect(agent.model).toBe('sonnet')
    })
  })

  it('throws NotFoundError for an unknown curated slug', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await expect(
        installCuratedAgent(db, { userId: user.id, workspaceId: null, slug: 'no-such-agent' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('an installed curated agent resolves into a valid AgentDefinition', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await installCuratedAgent(db, { userId: user.id, workspaceId: null, slug: 'researcher' })

      const record = await resolveEnabledAgentsForSession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(record.researcher).toMatchObject({
        model: 'sonnet',
        tools: ['Read', 'Grep', 'Glob'],
      })
      expect(typeof record.researcher?.description).toBe('string')
      expect(typeof record.researcher?.prompt).toBe('string')
    })
  })
})

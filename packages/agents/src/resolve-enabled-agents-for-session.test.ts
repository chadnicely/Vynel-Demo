// Integration tests for `resolveEnabledAgentsForSession`. Real SQLite
// via `withTestDatabase` (no mocking). Verifies the resolver produces a
// valid SDK `Record<string, AgentDefinition>`. Spec:
// `docs/agent-base/agents.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createAgent, type CreateAgentInput } from './create-agent.js'
import { resolveEnabledAgentsForSession } from './resolve-enabled-agents-for-session.js'

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

function baseInput(userId: string, overrides: Partial<CreateAgentInput> = {}): CreateAgentInput {
  return {
    userId,
    workspaceId: null,
    slug: 'researcher',
    name: 'Researcher',
    description: 'Researches topics.',
    prompt: 'You research.',
    source: 'user',
    trustTier: 'community',
    ...overrides,
  }
}

describe('resolveEnabledAgentsForSession', () => {
  it('returns enabled agents as a slug-keyed record of valid AgentDefinitions', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      await createAgent(
        db,
        baseInput(user.id, {
          slug: 'researcher',
          workspaceId: null,
          allowedTools: ['Read', 'Grep'],
          model: 'sonnet',
        }),
      )
      await createAgent(
        db,
        baseInput(user.id, { slug: 'doc-gen', workspaceId: workspace.id, name: 'Doc Gen' }),
      )
      // Disabled — must be excluded.
      await createAgent(
        db,
        baseInput(user.id, { slug: 'dormant', workspaceId: null, enabled: false }),
      )

      const record = await resolveEnabledAgentsForSession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })

      expect(Object.keys(record).sort()).toEqual(['doc-gen', 'researcher'])
      // Valid AgentDefinition shape: required fields present, optionals mapped.
      expect(record.researcher).toMatchObject({
        description: 'Researches topics.',
        prompt: 'You research.',
        tools: ['Read', 'Grep'],
        model: 'sonnet',
      })
      expect(record.dormant).toBeUndefined()
    })
  })

  it('lets a workspace-scope agent override a user-scope agent with the same slug', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(
        db,
        baseInput(user.id, { slug: 'shared', workspaceId: null, prompt: 'USER LEVEL' }),
      )
      await createAgent(
        db,
        baseInput(user.id, { slug: 'shared', workspaceId: workspace.id, prompt: 'WORKSPACE LEVEL' }),
      )

      const record = await resolveEnabledAgentsForSession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(Object.keys(record)).toEqual(['shared'])
      expect(record.shared?.prompt).toBe('WORKSPACE LEVEL')
    })
  })

  it('maps preloaded skills into AgentDefinition.skills', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(
        db,
        baseInput(user.id, { slug: 'mailer', workspaceId: null, skillIds: ['email-drafter'] }),
      )

      const record = await resolveEnabledAgentsForSession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(record.mailer?.skills).toEqual(['email-drafter'])
    })
  })

  it('returns an empty record when no agents are enabled', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const record = await resolveEnabledAgentsForSession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(record).toEqual({})
    })
  })
})

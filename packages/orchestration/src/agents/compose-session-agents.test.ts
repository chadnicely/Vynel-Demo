// Test for `composeSessionAgents` — the orchestration entry point that
// produces the session's `Record<string, AgentDefinition>`. Real SQLite;
// verifies it surfaces enabled agents as valid AgentDefinitions
// (delegating to the agents resolver).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createAgentRowForTest as createAgent } from '@vynel/agents/test-support'
import { composeSessionAgents } from './compose-session-agents.js'

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

describe('composeSessionAgents', () => {
  it('composes enabled agents into a slug-keyed record of AgentDefinitions', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'researcher',
        name: 'Researcher',
        description: 'Researches topics.',
        prompt: 'You research.',
        source: 'user',
        trustTier: 'community',
        allowedTools: ['Read', 'Grep'],
      })
      await createAgent(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'dormant',
        name: 'Dormant',
        description: 'Disabled agent.',
        prompt: 'You sleep.',
        source: 'user',
        trustTier: 'community',
        enabled: false,
      })

      const agents = await composeSessionAgents(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })

      expect(Object.keys(agents)).toEqual(['researcher'])
      expect(agents.researcher).toMatchObject({
        description: 'Researches topics.',
        prompt: 'You research.',
        tools: ['Read', 'Grep'],
      })
    })
  })
})

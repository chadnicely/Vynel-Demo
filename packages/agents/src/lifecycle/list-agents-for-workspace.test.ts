// Integration test for `listAgentsForWorkspace`. Real SQLite via
// `withTestDatabase` (no mocking). The repo's union/soft-delete/tenant
// behavior is covered exhaustively in the repo test; this confirms the
// core pass-through wiring. Spec: `docs/agent-base/agents.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createAgentRow as createAgent, type CreateAgentInput } from './create-agent-row.js'
import { listAgentsForWorkspace } from './list-agents-for-workspace.js'

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
    description: 'Researches.',
    prompt: 'You research.',
    source: 'user',
    trustTier: 'community',
    ...overrides,
  }
}

describe('listAgentsForWorkspace', () => {
  it('returns the union of user-scope and workspace-scope agents', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(db, baseInput(user.id, { slug: 'global', workspaceId: null }))
      await createAgent(db, baseInput(user.id, { slug: 'local', workspaceId: workspace.id }))

      const list = await listAgentsForWorkspace(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(list.map((agent) => agent.slug).sort()).toEqual(['global', 'local'])
    })
  })

  it('returns user-scope agents only when workspaceId is null (the global surface)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(db, baseInput(user.id, { slug: 'global', workspaceId: null }))
      await createAgent(db, baseInput(user.id, { slug: 'local', workspaceId: workspace.id }))

      const list = await listAgentsForWorkspace(db, { userId: user.id, workspaceId: null })
      expect(list.map((agent) => agent.slug)).toEqual(['global'])
    })
  })
})

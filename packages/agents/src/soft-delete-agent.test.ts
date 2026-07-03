// Integration tests for `softDeleteAgent`. Real SQLite via
// `withTestDatabase` (no mocking). Spec: `docs/agent-base/agents.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { findAgentById } from '@vynel/db/repositories/agents'
import { NotFoundError } from '@vynel/errors'
import { createAgent, type CreateAgentInput } from './create-agent.js'
import { softDeleteAgent } from './soft-delete-agent.js'

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

describe('softDeleteAgent', () => {
  it('soft-deletes the agent so live reads no longer see it', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(user.id))
      await softDeleteAgent(db, { agentId: agent.id, userId: user.id })
      expect(findAgentById(db, agent.id)).toBeNull()
    })
  })

  it('throws NotFoundError when the agent belongs to another user', async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser())
      const other = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(owner.id))
      await expect(
        softDeleteAgent(db, { agentId: agent.id, userId: other.id }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('throws NotFoundError on the second call (already deleted)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(user.id))
      await softDeleteAgent(db, { agentId: agent.id, userId: user.id })
      await expect(
        softDeleteAgent(db, { agentId: agent.id, userId: user.id }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})

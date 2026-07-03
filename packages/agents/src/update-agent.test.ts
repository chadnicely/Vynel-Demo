// Integration tests for `updateAgent`. Real SQLite via `withTestDatabase`
// (no mocking). Spec: `docs/agent-base/agents.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { listSkillIdsForAgent } from '@vynel/db/repositories/agents'
import { ConflictError, NotFoundError } from '@vynel/errors'
import { createAgent, type CreateAgentInput } from './create-agent.js'
import { updateAgent } from './update-agent.js'

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

describe('updateAgent', () => {
  it('patches fields and leaves the skill set untouched when skillIds is omitted', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(user.id, { skillIds: ['email-drafter'] }))

      const updated = await updateAgent(db, {
        agentId: agent.id,
        userId: user.id,
        name: 'Renamed',
        enabled: false,
      })

      expect(updated.name).toBe('Renamed')
      expect(updated.enabled).toBe(false)
      // skills untouched
      expect(listSkillIdsForAgent(db, agent.id)).toEqual(['email-drafter'])
    })
  })

  it('replaces the skill set when skillIds is provided', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(user.id, { skillIds: ['email-drafter'] }))

      await updateAgent(db, {
        agentId: agent.id,
        userId: user.id,
        skillIds: ['doc-writer'],
      })

      expect(listSkillIdsForAgent(db, agent.id)).toEqual(['doc-writer'])
    })
  })

  it('clears the skill set when skillIds is an empty array', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(user.id, { skillIds: ['email-drafter'] }))

      await updateAgent(db, { agentId: agent.id, userId: user.id, skillIds: [] })

      expect(listSkillIdsForAgent(db, agent.id)).toEqual([])
    })
  })

  it('throws NotFoundError when the agent belongs to another user', async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser())
      const other = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(owner.id))
      await expect(
        updateAgent(db, { agentId: agent.id, userId: other.id, name: 'Hacked' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('throws NotFoundError for a missing agent', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await expect(
        updateAgent(db, { agentId: 'nope', userId: user.id, name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('throws ConflictError when renaming the slug onto an existing one at the same scope', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await createAgent(db, baseInput(user.id, { slug: 'taken' }))
      const mover = await createAgent(db, baseInput(user.id, { slug: 'mover' }))
      await expect(
        updateAgent(db, { agentId: mover.id, userId: user.id, slug: 'taken' }),
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })
})

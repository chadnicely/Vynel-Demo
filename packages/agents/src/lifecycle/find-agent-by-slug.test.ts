// Integration tests for `findAgentBySlug` / `getAgentBySlugOrThrow`.
// Real SQLite via `withTestDatabase` (no mocking). Spec:
// `docs/agent-base/agents.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { NotFoundError } from '@vynel/errors'
import { createAgentRow as createAgent, type CreateAgentInput } from './create-agent-row.js'
import { findAgentBySlug, getAgentBySlugOrThrow } from './find-agent-by-slug.js'

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

describe('findAgentBySlug', () => {
  it('returns the user-scope agent at that slug', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(user.id))
      const found = await findAgentBySlug(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'researcher',
      })
      expect(found?.id).toBe(agent.id)
    })
  })

  it('returns null when no agent matches the scope', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      expect(
        await findAgentBySlug(db, { userId: user.id, workspaceId: null, slug: 'nope' }),
      ).toBeNull()
    })
  })
})

describe('getAgentBySlugOrThrow', () => {
  it('returns the agent when present', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(user.id))
      const got = await getAgentBySlugOrThrow(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'researcher',
      })
      expect(got.id).toBe(agent.id)
    })
  })

  it('throws NotFoundError when absent', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await expect(
        getAgentBySlugOrThrow(db, { userId: user.id, workspaceId: null, slug: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})

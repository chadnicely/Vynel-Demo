// Integration tests for `createAgent`. Real SQLite via `withTestDatabase`
// (no mocking). Spec: `docs/agent-base/agents.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listSkillIdsForAgent } from '@vynel/db/repositories/agents'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ConflictError } from '@vynel/errors'
import { createAgentRow as createAgent, type CreateAgentInput } from './create-agent-row.js'
import { AGENT_CREATED } from '../agents-events.js'

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
    slug: 'doc-gen',
    name: 'Doc Gen',
    description: 'Writes documents.',
    prompt: 'You write documents.',
    source: 'user',
    trustTier: 'community',
    ...overrides,
  }
}

describe('createAgentRow', () => {
  it('persists the row, derives workspace scope, and inserts preloaded skills', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const agent = await createAgent(
        db,
        baseInput(user.id, {
          workspaceId: workspace.id,
          allowedTools: ['Read', 'Write'],
          skillIds: ['email-drafter'],
        }),
      )

      expect(agent.scope).toBe('workspace')
      expect(agent.workspaceId).toBe(workspace.id)
      expect(agent.enabled).toBe(true) // default
      expect(agent.background).toBe(false) // default
      expect(agent.source).toBe('user')
      expect(agent.allowedTools).toEqual(['Read', 'Write'])
      expect(listSkillIdsForAgent(db, agent.id)).toEqual(['email-drafter'])

      // Outbox event co-committed with the row.
      const events = listOutboxEventsByType(db, AGENT_CREATED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as Record<string, unknown>
      expect(payload.agentId).toBe(agent.id)
      expect(payload.slug).toBe('doc-gen')
      expect(payload.scope).toBe('workspace')
      expect(payload.workspaceId).toBe(workspace.id)
      expect(payload.source).toBe('user')
    })
  })

  it('derives user scope when workspaceId is null', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(user.id, { workspaceId: null }))
      expect(agent.scope).toBe('user')
      expect(agent.workspaceId).toBeNull()
    })
  })

  it('dedupes repeated skillIds', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(
        db,
        baseInput(user.id, { skillIds: ['email-drafter', 'email-drafter'] }),
      )
      expect(listSkillIdsForAgent(db, agent.id)).toEqual(['email-drafter'])
    })
  })

  it('throws ConflictError on a duplicate slug at the same scope', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await createAgent(db, baseInput(user.id, { slug: 'dup' }))
      await expect(createAgent(db, baseInput(user.id, { slug: 'dup' }))).rejects.toBeInstanceOf(
        ConflictError,
      )
      // A failed create leaves no stray event — only the first create's.
      expect(listOutboxEventsByType(db, AGENT_CREATED)).toHaveLength(1)
    })
  })

  it('allows the same slug at user-scope and workspace-scope', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const userScope = await createAgent(db, baseInput(user.id, { slug: 'dup', workspaceId: null }))
      const wsScope = await createAgent(
        db,
        baseInput(user.id, { slug: 'dup', workspaceId: workspace.id }),
      )
      expect(userScope.id).not.toBe(wsScope.id)
    })
  })
})

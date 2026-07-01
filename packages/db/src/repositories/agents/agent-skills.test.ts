// Repository integration tests for the `agent_skills` child table. Real
// SQLite via the local `withTestDatabase` helper (no DB mocking). Spec:
// `docs/agent-base/agents.md`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import {
  insertAgent,
  softDeleteAgent,
  hardDeleteAgentsDeletedBefore,
  type NewAgentRow,
} from './agents.js'
import {
  listSkillIdsForAgent,
  listSkillIdsForAgents,
  insertAgentSkill,
  deleteAgentSkillsForAgent,
} from './agent-skills.js'

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

function makeAgent(userId: string, overrides: Partial<NewAgentRow> = {}): NewAgentRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId: null,
    slug: 'researcher',
    name: 'Researcher',
    description: 'Researches topics.',
    icon: null,
    prompt: 'You research.',
    model: null,
    effort: null,
    permissionMode: null,
    background: false,
    allowedTools: null,
    disallowedTools: null,
    scope: 'user',
    source: 'vynel',
    trustTier: 'verified',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

describe('agent-skills repository', () => {
  describe('listSkillIdsForAgent', () => {
    it('returns the skill ids preloaded by an agent, ordered', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const agent = insertAgent(db, makeAgent(user.id))
        insertAgentSkill(db, { agentId: agent.id, skillId: 'email-drafter' })
        insertAgentSkill(db, { agentId: agent.id, skillId: 'doc-writer' })

        expect(listSkillIdsForAgent(db, agent.id)).toEqual(['doc-writer', 'email-drafter'])
      })
    })

    it('returns an empty array when the agent has no preloaded skills', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const agent = insertAgent(db, makeAgent(user.id))
        expect(listSkillIdsForAgent(db, agent.id)).toEqual([])
      })
    })

    it('scopes the list to one agent', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const a = insertAgent(db, makeAgent(user.id, { slug: 'a' }))
        const b = insertAgent(db, makeAgent(user.id, { slug: 'b' }))
        insertAgentSkill(db, { agentId: a.id, skillId: 'email-drafter' })
        insertAgentSkill(db, { agentId: b.id, skillId: 'doc-writer' })

        expect(listSkillIdsForAgent(db, a.id)).toEqual(['email-drafter'])
      })
    })
  })

  describe('listSkillIdsForAgents (batch)', () => {
    it('returns one Map entry per requested agent, including empties, in one query', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const withSkills = insertAgent(db, makeAgent(user.id, { slug: 'a' }))
        const withoutSkills = insertAgent(db, makeAgent(user.id, { slug: 'b' }))
        insertAgentSkill(db, { agentId: withSkills.id, skillId: 'email-drafter' })
        insertAgentSkill(db, { agentId: withSkills.id, skillId: 'doc-writer' })

        const byAgent = listSkillIdsForAgents(db, [withSkills.id, withoutSkills.id])
        expect(byAgent.get(withSkills.id)).toEqual(['doc-writer', 'email-drafter'])
        // Every requested id has an entry — empty array when no skills.
        expect(byAgent.get(withoutSkills.id)).toEqual([])
      })
    })

    it('returns an empty Map for an empty agentId list', async () => {
      await withTestDatabase((db) => {
        expect(listSkillIdsForAgents(db, []).size).toBe(0)
      })
    })
  })

  describe('insertAgentSkill', () => {
    it('rejects a duplicate (agentId, skillId) — composite PK', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const agent = insertAgent(db, makeAgent(user.id))
        insertAgentSkill(db, { agentId: agent.id, skillId: 'email-drafter' })
        expect(() =>
          insertAgentSkill(db, { agentId: agent.id, skillId: 'email-drafter' }),
        ).toThrow()
      })
    })
  })

  describe('deleteAgentSkillsForAgent', () => {
    it('removes every preload row for an agent and returns the count', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const agent = insertAgent(db, makeAgent(user.id))
        insertAgentSkill(db, { agentId: agent.id, skillId: 'email-drafter' })
        insertAgentSkill(db, { agentId: agent.id, skillId: 'doc-writer' })

        expect(deleteAgentSkillsForAgent(db, agent.id)).toBe(2)
        expect(listSkillIdsForAgent(db, agent.id)).toEqual([])
      })
    })
  })

  describe('FK cascade', () => {
    it('drops preload rows when the parent agent is hard-deleted (purge)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const agent = insertAgent(db, makeAgent(user.id))
        insertAgentSkill(db, { agentId: agent.id, skillId: 'email-drafter' })

        softDeleteAgent(db, agent.id, user.id)
        hardDeleteAgentsDeletedBefore(db, new Date(Date.now() + 60_000))

        expect(listSkillIdsForAgent(db, agent.id)).toEqual([])
      })
    })
  })
})

// Integration tests for `updateAgent`. Real SQLite via `withTestDatabase`
// (no mocking). Includes the disk-mirror sync for marketplace-sourced
// agents: disable removes `.claude/agents/<slug>.md`, enable/edit
// rewrites it, a slug rename moves it — LOAD-BEARING, because the SDK
// loads filesystem agents and only a same-named programmatic definition
// shadows the file. Spec: `docs/agent-base/agents.md`.

import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listSkillIdsForAgent } from '@vynel/db/repositories/agents'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ConflictError, NotFoundError } from '@vynel/errors'
import { createAgent, type CreateAgentInput } from './create-agent.js'
import { updateAgent } from './update-agent.js'
import { AGENT_UPDATED } from '../agents-events.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

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

      // Outbox event co-committed with the patch.
      const events = listOutboxEventsByType(db, AGENT_UPDATED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as Record<string, unknown>
      expect(payload.agentId).toBe(agent.id)
      expect(payload.slug).toBe('researcher')
      expect(payload.scope).toBe('user')
      expect(payload.workspaceId).toBeNull()
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
      // A rejected update emits nothing.
      expect(listOutboxEventsByType(db, AGENT_UPDATED)).toHaveLength(0)
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

describe('updateAgent — disk mirror sync (marketplace-sourced agents)', () => {
  type TestDatabase = Parameters<Parameters<typeof withTestDatabase>[0]>[0]

  // A community agent in a REAL tmpdir workspace, created through
  // `createAgent` (rows can predate the mirror feature — the first
  // update self-heals the file).
  async function seedCommunityAgent(db: TestDatabase) {
    const user = insertUser(db, makeUser())
    const now = new Date()
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'vynel-agent-update-ws-'))
    tempDirs.push(workspaceDir)
    const workspace = insertWorkspace(db, {
      id: randomUUID(),
      userId: user.id,
      name: 'Acme',
      kind: 'small-business',
      path: workspaceDir,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    })
    const agent = await createAgent(
      db,
      baseInput(user.id, { workspaceId: workspace.id, source: 'community' }),
    )
    return { user, workspaceDir, agent }
  }

  function mirrorPathIn(workspaceDir: string, slug: string): string {
    return path.join(workspaceDir, '.claude', 'agents', `${slug}.md`)
  }

  it('writes the mirror on update while enabled, and keeps its content matching the row', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspaceDir, agent } = await seedCommunityAgent(db)
      await updateAgent(db, { agentId: agent.id, userId: user.id, prompt: 'You research deeply.' })
      const mirror = await readFile(mirrorPathIn(workspaceDir, 'researcher'), 'utf8')
      expect(mirror).toContain('Managed by Vynel')
      expect(mirror).toContain('You research deeply.')
    })
  })

  it('removes the mirror on disable and restores it on enable (the file must never outlive the toggle)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspaceDir, agent } = await seedCommunityAgent(db)
      const mirrorPath = mirrorPathIn(workspaceDir, 'researcher')

      await updateAgent(db, { agentId: agent.id, userId: user.id, enabled: true })
      expect(await fileExists(mirrorPath)).toBe(true)

      // A disabled agent leaves options.agents — a leftover file would go
      // LIVE as a filesystem agent. The sync must remove it.
      await updateAgent(db, { agentId: agent.id, userId: user.id, enabled: false })
      expect(await fileExists(mirrorPath)).toBe(false)

      await updateAgent(db, { agentId: agent.id, userId: user.id, enabled: true })
      expect(await fileExists(mirrorPath)).toBe(true)
    })
  })

  it('moves the mirror on a slug rename', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspaceDir, agent } = await seedCommunityAgent(db)
      await updateAgent(db, { agentId: agent.id, userId: user.id, enabled: true })
      expect(await fileExists(mirrorPathIn(workspaceDir, 'researcher'))).toBe(true)

      await updateAgent(db, { agentId: agent.id, userId: user.id, slug: 'deep-researcher' })
      expect(await fileExists(mirrorPathIn(workspaceDir, 'researcher'))).toBe(false)
      expect(await fileExists(mirrorPathIn(workspaceDir, 'deep-researcher'))).toBe(true)
    })
  })

  it('never writes a mirror for a user-built agent', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const now = new Date()
      const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'vynel-agent-update-user-ws-'))
      tempDirs.push(workspaceDir)
      const workspace = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Acme',
        kind: 'small-business',
        path: workspaceDir,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      const agent = await createAgent(db, baseInput(user.id, { workspaceId: workspace.id }))
      await updateAgent(db, { agentId: agent.id, userId: user.id, prompt: 'Edited.' })
      expect(await fileExists(mirrorPathIn(workspaceDir, 'researcher'))).toBe(false)
    })
  })
})

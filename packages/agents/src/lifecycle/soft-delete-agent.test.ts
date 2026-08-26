// Integration tests for `softDeleteAgent`. Real SQLite via
// `withTestDatabase` (no mocking). Includes the disk-mirror behavior:
// a marketplace-sourced agent's `.claude/agents/<slug>.md` is removed
// with the row, while a hand-authored file that happens to sit at a
// deleted agent's path is never destroyed (marker-checked removal). Rows
// here are created through the row op — the mirror path is exercised by
// the mirror tests, and a user-scope fixture must never reach the real
// home. Spec: `docs/agent-base/agents.md`.

import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { findAgentById } from '@vynel/db/repositories/agents'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { createAgentRow as createAgent, type CreateAgentInput } from './create-agent-row.js'
import { softDeleteAgent } from './soft-delete-agent.js'
import { installCuratedAgent } from './install-curated-agent.js'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { AGENT_DELETED } from '../agents-events.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function withIsolatedHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'vynel-agent-delete-home-'))
  tempDirs.push(homeDir)
  return withHomeDir(homeDir, () => fn(homeDir))
}

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

describe('softDeleteAgent', () => {
  it('soft-deletes the agent so live reads no longer see it', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(db, baseInput(user.id))
      await softDeleteAgent(db, { agentId: agent.id, userId: user.id })
      expect(findAgentById(db, agent.id)).toBeNull()

      // Outbox event co-committed with the deletedAt flip.
      const events = listOutboxEventsByType(db, AGENT_DELETED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as Record<string, unknown>
      expect(payload.agentId).toBe(agent.id)
      expect(payload.slug).toBe('researcher')
      expect(payload.scope).toBe('user')
      expect(payload.workspaceId).toBeNull()
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
      // The failed second call's transaction rolled back — the first
      // delete's event is still the only one.
      expect(listOutboxEventsByType(db, AGENT_DELETED)).toHaveLength(1)
    })
  })

  it('removes a marketplace-sourced agent’s disk mirror with the row', async () => {
    await withTestDatabase(async (db) => {
      await withIsolatedHome(async (homeDir) => {
        const user = insertUser(db, makeUser())
        const agent = await installCuratedAgent(db, {
          userId: user.id,
          workspaceId: null,
          slug: 'researcher',
        })
        const mirrorPath = path.join(homeDir, '.claude', 'agents', 'researcher.md')
        expect(await fileExists(mirrorPath)).toBe(true)

        await softDeleteAgent(db, { agentId: agent.id, userId: user.id })
        expect(await fileExists(mirrorPath)).toBe(false)
      })
    })
  })

  it('never touches a hand-authored agent file when deleting a user-built agent', async () => {
    await withTestDatabase(async (db) => {
      await withIsolatedHome(async (homeDir) => {
        const user = insertUser(db, makeUser())
        const agent = await createAgent(db, baseInput(user.id)) // row only — no mirror written here
        // The user's OWN `.claude/agents/researcher.md`, not Vynel's.
        const handAuthoredPath = path.join(homeDir, '.claude', 'agents', 'researcher.md')
        await mkdir(path.dirname(handAuthoredPath), { recursive: true })
        await writeFile(handAuthoredPath, '---\nname: researcher\n---\nMine.', 'utf8')

        await softDeleteAgent(db, { agentId: agent.id, userId: user.id })
        expect(await readFile(handAuthoredPath, 'utf8')).toContain('Mine.')
      })
    })
  })
})

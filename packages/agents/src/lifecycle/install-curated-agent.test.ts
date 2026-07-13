// Integration tests for `installCuratedAgent` — the curated-seed install
// path. Real SQLite via `withTestDatabase` (no mocking). Exercises the
// real CURATED_AGENT_CATALOG end-to-end (catalog → row → resolved
// AgentDefinition). Installs are user-scope here, so every test isolates
// the host home — the install now writes the transparency mirror to
// `~/.claude/agents/<slug>.md` for real. Spec: `docs/agent-base/agents.md`.

import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listSkillIdsForAgent } from '@vynel/db/repositories/agents'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { installCuratedAgent } from './install-curated-agent.js'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { AGENT_CREATED } from '../agents-events.js'
import { resolveEnabledAgentsForSession } from '../session/resolve-enabled-agents-for-session.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function withIsolatedHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'vynel-curated-home-'))
  tempDirs.push(homeDir)
  return withHomeDir(homeDir, () => fn(homeDir))
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

describe('installCuratedAgent', () => {
  it('installs document-generator as a vynel/verified, enabled, user-scope row with its disk mirror', async () => {
    await withTestDatabase(async (db) => {
      await withIsolatedHome(async (homeDir) => {
        const user = insertUser(db, makeUser())
        const agent = await installCuratedAgent(db, {
          userId: user.id,
          workspaceId: null,
          slug: 'document-generator',
        })

        expect(agent.source).toBe('vynel')
        expect(agent.trustTier).toBe('verified')
        expect(agent.enabled).toBe(true)
        expect(agent.scope).toBe('user')
        expect(agent.allowedTools).toEqual(['Read', 'Write', 'Edit', 'Glob'])

        // Exactly ONE agent.created — the delegated createAgent emits it;
        // the install wrapper must not add a second. Provenance rides in
        // the payload's `source`.
        const events = listOutboxEventsByType(db, AGENT_CREATED)
        expect(events).toHaveLength(1)
        const payload = events[0]!.payload as Record<string, unknown>
        expect(payload.agentId).toBe(agent.id)
        expect(payload.source).toBe('vynel')

        // The transparency mirror landed in the user home, matching the row.
        const mirror = await readFile(
          path.join(homeDir, '.claude', 'agents', 'document-generator.md'),
          'utf8',
        )
        expect(mirror).toContain('Managed by Vynel')
        expect(mirror).toContain('name: "document-generator"')
        expect(mirror).toContain('tools: "Read, Write, Edit, Glob"')
        expect(mirror).toContain(agent.prompt.trimEnd())
      })
    })
  })

  it('installs inbox-assistant with its preloaded email-drafter skill', async () => {
    await withTestDatabase(async (db) => {
      await withIsolatedHome(async () => {
        const user = insertUser(db, makeUser())
        const agent = await installCuratedAgent(db, {
          userId: user.id,
          workspaceId: null,
          slug: 'inbox-assistant',
        })
        expect(listSkillIdsForAgent(db, agent.id)).toEqual(['email-drafter'])
      })
    })
  })

  it('installs researcher with the sonnet model', async () => {
    await withTestDatabase(async (db) => {
      await withIsolatedHome(async () => {
        const user = insertUser(db, makeUser())
        const agent = await installCuratedAgent(db, {
          userId: user.id,
          workspaceId: null,
          slug: 'researcher',
        })
        expect(agent.model).toBe('sonnet')
      })
    })
  })

  it('throws NotFoundError for an unknown curated slug', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await expect(
        installCuratedAgent(db, { userId: user.id, workspaceId: null, slug: 'no-such-agent' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('an installed curated agent resolves into a valid AgentDefinition', async () => {
    await withTestDatabase(async (db) => {
      await withIsolatedHome(async () => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        await installCuratedAgent(db, { userId: user.id, workspaceId: null, slug: 'researcher' })

        const record = await resolveEnabledAgentsForSession(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(record.researcher).toMatchObject({
          model: 'sonnet',
          tools: ['Read', 'Grep', 'Glob'],
        })
        expect(typeof record.researcher?.description).toBe('string')
        expect(typeof record.researcher?.prompt).toBe('string')
      })
    })
  })
})

// Tests for composer-token resolution. The grammar itself is tested in
// `@vynel/contracts` (composer-tokens.test.ts); these cover the LOOKUP —
// against real SQLite (no DB mocking).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createAgentRowForTest as createAgent } from '@vynel/agents/test-support'
import { resolveMentions } from './resolve-mentions.js'

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

function makeWorkspace(
  userId: string,
  options: { name?: string; managerName?: string; lastAccessedAt?: Date } = {},
) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: options.name ?? 'Acme',
    ...(options.managerName !== undefined ? { managerName: options.managerName } : {}),
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: options.lastAccessedAt ?? now,
  }
}

function agentInput(userId: string, slug: string, workspaceId: string | null = null) {
  return {
    userId,
    workspaceId,
    slug,
    name: slug,
    description: 'Helps.',
    prompt: 'You help.',
    source: 'user' as const,
    trustTier: 'community' as const,
  }
}

describe('resolveMentions — agents', () => {
  it('resolves matched slugs and drops unmatched tokens', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const researcher = await createAgent(db, agentInput(user.id, 'researcher'))

      const resolved = await resolveMentions(db, {
        text: 'ask @researcher and @ghost-agent to help',
        userId: user.id,
        workspaceId: workspace.id,
      })

      expect(resolved.agents).toEqual([
        { slug: 'researcher', agentId: researcher.id, name: 'researcher' },
      ])
      expect(resolved.personas).toEqual([])
      expect(resolved.workspaceRefs).toEqual([])
    })
  })

  it('dedupes a repeated mention to one entry', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(db, agentInput(user.id, 'helper'))

      const resolved = await resolveMentions(db, {
        text: '@helper then @helper again',
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(resolved.agents).toHaveLength(1)
    })
  })

  it('works at the GLOBAL root (workspaceId null) — user-scope agents resolve', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const agent = await createAgent(db, agentInput(user.id, 'user-scope-agent'))

      const resolved = await resolveMentions(db, {
        text: 'hey @user-scope-agent',
        userId: user.id,
        workspaceId: null,
      })
      expect(resolved.agents).toEqual([
        { slug: 'user-scope-agent', agentId: agent.id, name: 'user-scope-agent' },
      ])
    })
  })

  it('a workspace-scoped agent resolves in its workspace but not at the global root', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(db, agentInput(user.id, 'room-agent', workspace.id))

      const inRoom = await resolveMentions(db, {
        text: '@room-agent',
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(inRoom.agents).toHaveLength(1)

      const atRoot = await resolveMentions(db, {
        text: '@room-agent',
        userId: user.id,
        workspaceId: null,
      })
      expect(atRoot.agents).toEqual([])
    })
  })
})

describe('resolveMentions — personas', () => {
  it('resolves an explicit manager name to its workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(
        db,
        makeWorkspace(user.id, { name: 'Acme', managerName: 'Sarah' }),
      )

      const resolved = await resolveMentions(db, {
        text: '@Sarah what is the status?',
        userId: user.id,
        workspaceId: null,
      })
      expect(resolved.personas).toEqual([
        {
          managerName: 'Sarah',
          workspaceId: workspace.id,
          workspaceName: 'Acme',
          workspacePath: workspace.path,
        },
      ])
    })
  })

  it('resolves the DEFAULT manager name — the workspace name — for a null-managerName row', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id, { name: 'Bookkeeping' }))

      const resolved = await resolveMentions(db, {
        text: 'hello @Bookkeeping',
        userId: user.id,
        workspaceId: null,
      })
      expect(resolved.personas.map((p) => p.workspaceId)).toEqual([workspace.id])
    })
  })

  it('persona matching is case-sensitive — @sarah is not @Sarah', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      insertWorkspace(db, makeWorkspace(user.id, { managerName: 'Sarah' }))

      const resolved = await resolveMentions(db, {
        text: '@sarah hello',
        userId: user.id,
        workspaceId: null,
      })
      expect(resolved.personas).toEqual([])
    })
  })

  it('an agent slug wins over a colliding persona name (precedence)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      insertWorkspace(db, makeWorkspace(user.id, { managerName: 'sarah' }))
      const agent = await createAgent(db, agentInput(user.id, 'sarah'))

      const resolved = await resolveMentions(db, {
        text: '@sarah go',
        userId: user.id,
        workspaceId: null,
      })
      expect(resolved.agents.map((a) => a.agentId)).toEqual([agent.id])
      expect(resolved.personas).toEqual([])
    })
  })

  it('two workspaces sharing a manager name resolve to the most recently accessed', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      insertWorkspace(
        db,
        makeWorkspace(user.id, {
          name: 'Older',
          managerName: 'Mark',
          lastAccessedAt: new Date('2026-01-01T00:00:00Z'),
        }),
      )
      const recent = insertWorkspace(
        db,
        makeWorkspace(user.id, {
          name: 'Newer',
          managerName: 'Mark',
          lastAccessedAt: new Date('2026-06-01T00:00:00Z'),
        }),
      )

      const resolved = await resolveMentions(db, {
        text: '@Mark status?',
        userId: user.id,
        workspaceId: null,
      })
      expect(resolved.personas.map((p) => p.workspaceId)).toEqual([recent.id])
    })
  })
})

describe('resolveMentions — workspace refs', () => {
  it('resolves simple and quoted refs, case-insensitively', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const vynel = insertWorkspace(db, makeWorkspace(user.id, { name: 'Vynel' }))
      const plans = insertWorkspace(db, makeWorkspace(user.id, { name: 'Q3 plans' }))

      const resolved = await resolveMentions(db, {
        text: 'compare #vynel with #"Q3 plans"',
        userId: user.id,
        workspaceId: null,
      })
      expect(resolved.workspaceRefs.map((ref) => ref.workspaceId)).toEqual([
        vynel.id,
        plans.id,
      ])
      expect(resolved.workspaceRefs[0]?.managerName.length).toBeGreaterThan(0)
    })
  })

  it("drops a ref that matches no workspace and never crosses tenants", async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      insertWorkspace(db, makeWorkspace(owner.id, { name: 'Private' }))

      const resolved = await resolveMentions(db, {
        text: 'open #Private and #missing',
        userId: stranger.id,
        workspaceId: null,
      })
      expect(resolved.workspaceRefs).toEqual([])
    })
  })

  it('dedupes repeated refs to one entry', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      insertWorkspace(db, makeWorkspace(user.id, { name: 'Vynel' }))

      const resolved = await resolveMentions(db, {
        text: '#vynel then #Vynel again',
        userId: user.id,
        workspaceId: null,
      })
      expect(resolved.workspaceRefs).toHaveLength(1)
    })
  })
})

describe('resolveMentions — no tokens', () => {
  it('returns the empty resolution without touching agent data', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const resolved = await resolveMentions(db, {
        text: 'no tokens here at all',
        userId: user.id,
        workspaceId: null,
      })
      expect(resolved).toEqual({ agents: [], personas: [], workspaceRefs: [] })
    })
  })
})

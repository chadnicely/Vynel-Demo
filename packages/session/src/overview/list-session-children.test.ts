// Tests for `listSessionChildren` — the parent→children read behind the node
// screen's third level. Real SQLite; the jobs are written by the real enqueue
// ops so the column semantics under test are the production ones.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from '@vynel/chat/repositories'
import {
  enqueueAgentRun,
  enqueueReportDelivery,
  enqueueSessionDelegation,
  enqueueWorkspaceDelegation,
} from '@vynel/orchestration'
import { insertPrimarySession } from '../repositories/index.js'
import { listSessionChildren } from './list-session-children.js'

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(db: Database, userId: string, name = 'Acme') {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name,
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function makeSession(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewChatSession> = {},
): NewChatSession {
  const now = new Date('2026-08-01T00:00:00Z')
  return {
    id: `sdk-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'A conversation',
    visibility: 'listed',
    scope: 'workspace',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** A spawned conversation: its primary plus the segment it is currently on. */
function seedSpawnedSession(db: Database, userId: string, title: string) {
  const now = new Date('2026-08-01T00:00:00Z')
  const segment = insertChatSession(
    db,
    makeSession(userId, null, { title, scope: 'spawned' }),
  )
  const primary = insertPrimarySession(db, {
    id: randomUUID(),
    userId,
    workspaceId: null,
    scope: 'spawned',
    currentSdkSessionId: segment.id,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  return { primary, segment }
}

/** Staggered so `createdAt` orders the answer deterministically. */
function clockFrom(startIso: string) {
  let tick = 0
  return () => new Date(Date.parse(startIso) + tick++ * 1000)
}

describe('listSessionChildren', () => {
  it('lists the tasks, agent runs and spawned sessions one conversation set going', () => {
    withTestDatabase((db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const parent = insertChatSession(db, makeSession(user.id, workspace.id))
      const child = seedSpawnedSession(db, user.id, 'Research: pricing')
      const now = clockFrom('2026-08-19T09:00:00Z')

      enqueueWorkspaceDelegation(
        db,
        {
          userId: user.id,
          parentSessionId: parent.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          workspaceName: workspace.name,
          taskText: 'Reconcile the July invoices',
        },
        { now },
      )
      enqueueSessionDelegation(
        db,
        {
          userId: user.id,
          parentSessionId: parent.id,
          targetPrimarySessionId: child.primary.id,
          runCwdPath: workspace.path,
          taskText: 'Summarise the competitor pricing page',
        },
        { now },
      )
      enqueueAgentRun(
        db,
        {
          userId: user.id,
          parentSessionId: parent.id,
          agentSlug: 'researcher',
          agentName: 'Rosa',
          taskText: 'Check the sources',
          workspaceId: workspace.id,
          runCwdPath: workspace.path,
        },
        { now },
      )

      const children = listSessionChildren(db, {
        userId: user.id,
        sessionId: parent.id,
      })

      expect(children?.sessionId).toBe(parent.id)
      expect(children?.children.map((row) => [row.kind, row.title])).toEqual([
        ['task', 'Reconcile the July invoices'],
        ['task', 'Summarise the competitor pricing page'],
        ['session', 'Research: pricing'],
        ['agent-run', 'Rosa'],
      ])
      // The child's HANDLE, not its primary id — the caller walks straight
      // back down into `/sessions/:sessionId/children`. And a conversation's
      // light comes from the status pipeline, never from here.
      const spawned = children!.children.find((row) => row.kind === 'session')
      expect(spawned).toMatchObject({ id: child.segment.id, status: null })
      expect(children!.children[0]).toMatchObject({
        status: 'queued',
        workspaceId: workspace.id,
        finishedAt: null,
      })
    })
  })

  it('names a spawned child ONCE however many tasks it is sent', () => {
    withTestDatabase((db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const parent = insertChatSession(db, makeSession(user.id, workspace.id))
      const child = seedSpawnedSession(db, user.id, 'Research: pricing')
      const now = clockFrom('2026-08-19T09:00:00Z')

      for (const taskText of ['First pass', 'Second pass']) {
        enqueueSessionDelegation(
          db,
          {
            userId: user.id,
            parentSessionId: parent.id,
            targetPrimarySessionId: child.primary.id,
            runCwdPath: workspace.path,
            taskText,
          },
          { now },
        )
      }

      const children = listSessionChildren(db, {
        userId: user.id,
        sessionId: parent.id,
      })
      expect(children!.children.filter((row) => row.kind === 'session')).toHaveLength(1)
      expect(children!.children.filter((row) => row.kind === 'task')).toHaveLength(2)
    })
  })

  it('finds children started before a context swap, from any segment of the chain', () => {
    withTestDatabase((db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const before = insertChatSession(db, makeSession(user.id, workspace.id))
      const after = insertChatSession(
        db,
        makeSession(user.id, workspace.id, {
          title: 'Continued conversation',
          continuedFromSessionId: before.id,
        }),
      )
      const now = clockFrom('2026-08-19T09:00:00Z')

      enqueueWorkspaceDelegation(
        db,
        {
          userId: user.id,
          parentSessionId: before.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          workspaceName: workspace.name,
          taskText: 'Started before the swap',
        },
        { now },
      )
      enqueueWorkspaceDelegation(
        db,
        {
          userId: user.id,
          parentSessionId: after.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          workspaceName: workspace.name,
          taskText: 'Started after the swap',
        },
        { now },
      )

      // Asked from EITHER end, the answer is the whole conversation's.
      for (const sessionId of [before.id, after.id]) {
        const children = listSessionChildren(db, { userId: user.id, sessionId })
        expect(children!.children.map((row) => row.title)).toEqual([
          'Started before the swap',
          'Started after the swap',
        ])
      }
    })
  })

  it('a delivery is a message between conversations, not a child', () => {
    withTestDatabase((db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const parent = insertChatSession(db, makeSession(user.id, workspace.id))

      // `parentSessionId` on a delivery row is the REPORTER's session — the
      // same column, a different relation. Drawing it as a child would make
      // every answered task look like a conversation this one created.
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: parent.id,
        reporterLabel: 'Rosa · Acme',
        reportBody: 'Done.',
        requester: {
          kind: 'workspace-primary',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        },
      })

      const children = listSessionChildren(db, {
        userId: user.id,
        sessionId: parent.id,
      })
      expect(children!.children).toEqual([])
    })
  })

  it('a conversation with no children answers empty, not null', () => {
    withTestDatabase((db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const parent = insertChatSession(db, makeSession(user.id, workspace.id))
      expect(listSessionChildren(db, { userId: user.id, sessionId: parent.id })).toEqual({
        sessionId: parent.id,
        children: [],
      })
    })
  })

  it("an unknown session and another user's answer alike — null", () => {
    withTestDatabase((db) => {
      const user = seedUser(db)
      const stranger = seedUser(db)
      const workspace = seedWorkspace(db, stranger.id)
      const theirs = insertChatSession(db, makeSession(stranger.id, workspace.id))

      expect(listSessionChildren(db, { userId: user.id, sessionId: theirs.id })).toBeNull()
      expect(
        listSessionChildren(db, { userId: user.id, sessionId: 'no-such-session' }),
      ).toBeNull()
    })
  })

  it("never returns another user's jobs, even on the same parent id", () => {
    withTestDatabase((db) => {
      const user = seedUser(db)
      const stranger = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const strangerWorkspace = seedWorkspace(db, stranger.id)
      const parent = insertChatSession(db, makeSession(user.id, workspace.id))
      const now = clockFrom('2026-08-19T09:00:00Z')

      // A loose text ref, so nothing at the DB layer stops a foreign job from
      // naming this session as its parent — the userId filter is the wall.
      enqueueWorkspaceDelegation(
        db,
        {
          userId: stranger.id,
          parentSessionId: parent.id,
          workspaceId: strangerWorkspace.id,
          workspacePath: strangerWorkspace.path,
          workspaceName: strangerWorkspace.name,
          taskText: 'Not yours',
        },
        { now },
      )

      const children = listSessionChildren(db, {
        userId: user.id,
        sessionId: parent.id,
      })
      expect(children!.children).toEqual([])
    })
  })
})

describe('listSessionChildren — the shapes a cap or a fork could hide', () => {
  it('keeps the NEWEST children when the read hits its cap', () => {
    withTestDatabase((db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const parent = insertChatSession(db, makeSession(user.id, workspace.id))
      const now = clockFrom('2026-08-19T09:00:00Z')

      // Past the repository's default page, a cap that truncated from the OLD
      // end would drop exactly today's work — the bug class this slice is
      // fixing elsewhere on the same screen.
      for (let n = 0; n < 60; n += 1) {
        enqueueWorkspaceDelegation(
          db,
          {
            userId: user.id,
            parentSessionId: parent.id,
            workspaceId: workspace.id,
            workspacePath: workspace.path,
            workspaceName: workspace.name,
            taskText: `Task ${String(n).padStart(2, '0')}`,
          },
          { now },
        )
      }

      const children = listSessionChildren(db, {
        userId: user.id,
        sessionId: parent.id,
      })
      const titles = children!.children.map((row) => row.title)
      expect(titles).toHaveLength(50)
      // Oldest-first inside the page, and the page is the NEWEST 50.
      expect(titles[0]).toBe('Task 10')
      expect(titles[titles.length - 1]).toBe('Task 59')
    })
  })

  it('answers for the segment it was ASKED about, even on a forked chain', () => {
    withTestDatabase((db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const head = insertChatSession(db, makeSession(user.id, workspace.id))
      // A crashed double swap: one parent, two claimants. The fold keeps the
      // newest, so the forward walk steps past the other one entirely.
      const newer = insertChatSession(
        db,
        makeSession(user.id, workspace.id, {
          title: 'Newer claimant',
          continuedFromSessionId: head.id,
        }),
      )
      const orphaned = insertChatSession(
        db,
        makeSession(user.id, workspace.id, {
          title: 'Older claimant',
          continuedFromSessionId: head.id,
        }),
      )
      const now = clockFrom('2026-08-19T09:00:00Z')

      for (const [segment, taskText] of [
        [orphaned, 'Only the older claimant started this'],
        [newer, 'Only the newer claimant started this'],
      ] as const) {
        enqueueWorkspaceDelegation(
          db,
          {
            userId: user.id,
            parentSessionId: segment.id,
            workspaceId: workspace.id,
            workspacePath: workspace.path,
            workspaceName: workspace.name,
            taskText,
          },
          { now },
        )
      }

      const asked = listSessionChildren(db, {
        userId: user.id,
        sessionId: orphaned.id,
      })
      expect(asked!.children.map((row) => row.title)).toContain(
        'Only the older claimant started this',
      )
    })
  })
})

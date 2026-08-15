// Who spoke to whom, just now. Real SQLite. The load-bearing thing here is
// DIRECTION — an edge drawn backwards is a picture that lies about who asked
// whom — so every kind's from/to is pinned, plus the window and the thread walk
// that lets a reply know where it came from.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { enqueueWorkspaceDelegation } from '../routing/enqueue-workspace-delegation.js'
import { enqueueReportDelivery } from '../routing/enqueue-report-delivery.js'
import { findDelegationJobById } from '../repositories/index.js'
import { listRecentMessageEdges } from './list-recent-message-edges.js'

const T0 = new Date('2026-08-15T12:00:00.000Z')
const at = (offsetMs: number) => () => new Date(T0.getTime() + offsetMs)

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(db: Database, userId: string, name: string) {
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

describe('listRecentMessageEdges', () => {
  it('an ask travels from the requester to the workspace it was handed to', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const home = seedWorkspace(db, user.id, 'Home')
      const target = seedWorkspace(db, user.id, 'Acme')

      enqueueWorkspaceDelegation(
        db,
        {
          userId: user.id,
          parentSessionId: 'session-home',
          workspaceId: target.id,
          workspacePath: target.path,
          workspaceName: target.name,
          taskText: 'ship it',
          requesterWorkspaceId: home.id,
        },
        { now: at(0) },
      )

      const [edge] = listRecentMessageEdges(db, { userId: user.id, since: T0 })
      expect(edge).toMatchObject({
        direction: 'ask',
        fromSessionId: 'session-home',
        fromWorkspaceId: home.id,
        toWorkspaceId: target.id,
      })
    })
  })

  it('a reply travels the other way — and finds its sender through the thread', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const home = seedWorkspace(db, user.id, 'Home')
      const target = seedWorkspace(db, user.id, 'Acme')

      // The ask: Home hands work to Acme.
      const askId = enqueueWorkspaceDelegation(
        db,
        {
          userId: user.id,
          parentSessionId: 'session-home',
          workspaceId: target.id,
          workspacePath: target.path,
          workspaceName: target.name,
          taskText: 'ship it',
          requesterWorkspaceId: home.id,
        },
        { now: at(0) },
      )
      const ask = findDelegationJobById(db, askId)!
      const thread = ask.threadId ?? ask.partialSessionId

      // The reply: Acme's child reports home on the SAME thread. Its own row
      // never records which workspace it ran in — only the thread knows.
      enqueueReportDelivery(
        db,
        {
          ...(thread === null ? {} : { threadId: thread }),
          userId: user.id,
          reporterSessionId: 'session-acme-child',
          reporterLabel: 'Mark · Acme',
          reportBody: 'shipped',
          requester: {
            kind: 'workspace-primary',
            workspaceId: home.id,
            workspacePath: home.path,
          },
        },
        { now: at(1000) },
      )

      const edges = listRecentMessageEdges(db, { userId: user.id, since: T0 })
      const reply = edges.find((edge) => edge.direction === 'reply')
      expect(reply).toMatchObject({
        fromSessionId: 'session-acme-child',
        // Recovered from the ask — the reply row itself never says it.
        fromWorkspaceId: target.id,
        toWorkspaceId: home.id,
      })
    })
  })

  it('a reply to the global root has no destination workspace — that is the core', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      enqueueReportDelivery(
        db,
        {
          userId: user.id,
          reporterSessionId: 'session-child',
          reporterLabel: 'Mark',
          reportBody: 'done',
          requester: { kind: 'global-root' },
        },
        { now: at(0) },
      )

      const [edge] = listRecentMessageEdges(db, { userId: user.id, since: T0 })
      expect(edge).toMatchObject({
        direction: 'reply',
        fromSessionId: 'session-child',
        toWorkspaceId: null,
        toSessionId: null,
      })
    })
  })

  it('only reports what happened inside the window', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const target = seedWorkspace(db, user.id, 'Acme')
      const enqueueAt = (offsetMs: number) =>
        enqueueWorkspaceDelegation(
          db,
          {
            userId: user.id,
            parentSessionId: 'session-home',
            workspaceId: target.id,
            workspacePath: target.path,
            workspaceName: target.name,
            taskText: 'ship it',
          },
          { now: at(offsetMs) },
        )
      enqueueAt(-600_000) // ten minutes before the window
      enqueueAt(30_000)

      const edges = listRecentMessageEdges(db, { userId: user.id, since: T0 })
      expect(edges).toHaveLength(1)
      expect(edges[0]!.at).toBe(new Date(T0.getTime() + 30_000).toISOString())
    })
  })

  it("never reports another user's traffic", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const other = seedUser(db)
      const target = seedWorkspace(db, other.id, 'Theirs')
      enqueueWorkspaceDelegation(
        db,
        {
          userId: other.id,
          parentSessionId: 'session-theirs',
          workspaceId: target.id,
          workspacePath: target.path,
          workspaceName: target.name,
          taskText: 'private',
        },
        { now: at(0) },
      )

      expect(listRecentMessageEdges(db, { userId: user.id, since: T0 })).toEqual([])
    })
  })
})

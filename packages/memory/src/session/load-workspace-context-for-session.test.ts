import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertEntry,
  insertMemoryTags,
  countMentionsForEntry,
  type NewMemoryEntry,
} from '../repositories/index.js'
import { CONTEXT_MEMORY_TAG } from '../memory-tags.js'
import { loadWorkspaceContextForSession } from './load-workspace-context-for-session.js'

function seedWorld(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}
function makeEntry(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewMemoryEntry>,
): NewMemoryEntry {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    kind: 'note',
    title: 'T',
    body: 'B',
    category: 'memory',
    section: 'Things to remember',
    sourceMessageId: null,
    createdSource: 'user-manual',
    embedding: null,
    embeddingModelVersion: null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastMentionedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

describe('loadWorkspaceContextForSession', () => {
  it('buckets entries by kind + records a session-context-load mention on every returned entry', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const persons = [
        insertEntry(db, makeEntry(user.id, workspace.id, { kind: 'person', title: 'p1' })),
        insertEntry(db, makeEntry(user.id, workspace.id, { kind: 'person', title: 'p2' })),
      ]
      const note = insertEntry(db, makeEntry(user.id, workspace.id, { kind: 'note', title: 'n1' }))

      const snapshot = loadWorkspaceContextForSession(db, {
        workspaceId: workspace.id,
        sessionId: 's-1',
        messageId: 'm-1',
        topEntriesPerKind: 5,
      })

      expect(snapshot.topEntriesByKind.person.map((e) => e.id).sort()).toEqual(
        persons.map((p) => p.id).sort(),
      )
      expect(snapshot.topEntriesByKind.note.map((e) => e.id)).toEqual([note.id])
      expect(snapshot.topEntriesByKind.preference).toEqual([])
      expect(snapshot.topEntriesByKind['business-fact']).toEqual([])
      expect(snapshot.topEntriesByKind['recurring-pattern']).toEqual([])

      // Every returned entry got a mention.
      expect(countMentionsForEntry(db, persons[0]!.id)).toBe(1)
      expect(countMentionsForEntry(db, persons[1]!.id)).toBe(1)
      expect(countMentionsForEntry(db, note.id)).toBe(1)
    })
  })

  it('respects topEntriesPerKind cap', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      for (let i = 0; i < 15; i++) {
        insertEntry(db, makeEntry(user.id, workspace.id, { kind: 'person', title: `p${i}` }))
      }
      const snapshot = loadWorkspaceContextForSession(db, {
        workspaceId: workspace.id,
        sessionId: 's-1',
        messageId: 'm-1',
        topEntriesPerKind: 3,
      })
      expect(snapshot.topEntriesByKind.person).toHaveLength(3)
    })
  })

  it('context-tagged entries ALONE form the snapshot once any exist (selective injection)', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const standing = insertEntry(
        db,
        makeEntry(user.id, workspace.id, { kind: 'business-fact', title: 'standing' }),
      )
      insertMemoryTags(db, standing.id, [CONTEXT_MEMORY_TAG, 'project'], new Date())
      // Ordinary entries — tagged or not, they stay OUT of the snapshot now.
      const ordinary = insertEntry(
        db,
        makeEntry(user.id, workspace.id, { kind: 'person', title: 'ordinary' }),
      )
      insertMemoryTags(db, ordinary.id, ['person'], new Date())
      insertEntry(db, makeEntry(user.id, workspace.id, { kind: 'note', title: 'untagged' }))

      const snapshot = loadWorkspaceContextForSession(db, {
        workspaceId: workspace.id,
        sessionId: 's-1',
        messageId: 'm-1',
      })

      expect(snapshot.topEntriesByKind['business-fact'].map((e) => e.id)).toEqual([standing.id])
      expect(snapshot.topEntriesByKind.person).toEqual([])
      expect(snapshot.topEntriesByKind.note).toEqual([])
      // The injected entry still advances its recency signal.
      expect(countMentionsForEntry(db, standing.id)).toBe(1)
      expect(countMentionsForEntry(db, ordinary.id)).toBe(0)
    })
  })

  it('archived and deleted context-tagged entries stay out of the snapshot', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const archived = insertEntry(
        db,
        makeEntry(user.id, workspace.id, { kind: 'note', isArchived: true }),
      )
      insertMemoryTags(db, archived.id, [CONTEXT_MEMORY_TAG], new Date())
      const live = insertEntry(db, makeEntry(user.id, workspace.id, { kind: 'note', title: 'live' }))

      const snapshot = loadWorkspaceContextForSession(db, { workspaceId: workspace.id })
      // No LIVE context-tagged entry exists → falls back to top-N per kind.
      expect(snapshot.topEntriesByKind.note.map((e) => e.id)).toContain(live.id)
    })
  })

  it('omits mentions when no session id is supplied (session-build snapshot)', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const entry = insertEntry(db, makeEntry(user.id, workspace.id, { kind: 'person', title: 'p1' }))
      const snapshot = loadWorkspaceContextForSession(db, { workspaceId: workspace.id })
      expect(snapshot.topEntriesByKind.person.map((e) => e.id)).toEqual([entry.id])
      expect(countMentionsForEntry(db, entry.id)).toBe(0)
    })
  })
})

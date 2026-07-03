import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findEntryById,
  insertEntry,
  insertMention,
  countMentionsForEntry,
} from '../repositories/index.js'
import { cleanupMemoryForChatSessionHardDeleted } from './cleanup-memory-for-chat-session-hard-deleted.js'

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

function seedEntry(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  userId: string,
  workspaceId: string,
  sourceMessageId: string | null = null,
) {
  const now = new Date()
  return insertEntry(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    kind: 'note',
    title: 'T',
    body: 'B',
    category: 'memory',
    section: 'Things to remember',
    sourceMessageId,
    createdSource: 'user-manual',
    embedding: null,
    embeddingModelVersion: null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastMentionedAt: null,
    deletedAt: null,
  })
}

describe('cleanupMemoryForChatSessionHardDeleted', () => {
  it('deletes mention rows for the hard-deleted session', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const entry = seedEntry(db, user.id, workspace.id)
      insertMention(db, {
        id: randomUUID(),
        memoryEntryId: entry.id,
        sessionId: 's-doomed',
        messageId: 'm-1',
        mentionKind: 'session-context-load',
        mentionedAt: new Date(),
      })
      insertMention(db, {
        id: randomUUID(),
        memoryEntryId: entry.id,
        sessionId: 's-survives',
        messageId: 'm-2',
        mentionKind: 'agent-citation',
        mentionedAt: new Date(),
      })
      expect(countMentionsForEntry(db, entry.id)).toBe(2)

      const result = cleanupMemoryForChatSessionHardDeleted(db, {
        sessionId: 's-doomed',
        hardDeletedMessageIds: [],
      })
      expect(result.mentionsDeleted).toBe(1)
      expect(result.sourceMessageIdsNulled).toBe(0)
      expect(countMentionsForEntry(db, entry.id)).toBe(1)
    })
  })

  it('nulls sourceMessageId on memory entries when their message id is in the hard-deleted set', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedWorld(db)
      const e1 = seedEntry(db, user.id, workspace.id, 'msg-doomed-1')
      const e2 = seedEntry(db, user.id, workspace.id, 'msg-doomed-2')
      const e3 = seedEntry(db, user.id, workspace.id, 'msg-survives')

      const result = cleanupMemoryForChatSessionHardDeleted(db, {
        sessionId: 's-1',
        hardDeletedMessageIds: ['msg-doomed-1', 'msg-doomed-2'],
      })
      expect(result.sourceMessageIdsNulled).toBe(2)

      expect(findEntryById(db, e1.id)?.sourceMessageId).toBeNull()
      expect(findEntryById(db, e2.id)?.sourceMessageId).toBeNull()
      expect(findEntryById(db, e3.id)?.sourceMessageId).toBe('msg-survives')
    })
  })

  it('handles empty hardDeletedMessageIds + nonexistent sessionId cleanly (no-op)', async () => {
    await withTestDatabase((db) => {
      const result = cleanupMemoryForChatSessionHardDeleted(db, {
        sessionId: 's-never-existed',
        hardDeletedMessageIds: [],
      })
      expect(result).toEqual({ mentionsDeleted: 0, sourceMessageIdsNulled: 0 })
    })
  })
})

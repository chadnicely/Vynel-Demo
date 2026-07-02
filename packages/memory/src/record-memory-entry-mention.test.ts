import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findEntryById, insertEntry, countMentionsForEntry } from '@vynel/db/repositories/memory'
import { recordMemoryEntryMention } from './record-memory-entry-mention.js'

describe('recordMemoryEntryMention', () => {
  it('inserts the mention row + touches lastMentionedAt atomically', async () => {
    await withTestDatabase((db) => {
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
      const entry = insertEntry(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
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
      })
      expect(entry.lastMentionedAt).toBeNull()

      recordMemoryEntryMention(db, {
        memoryEntryId: entry.id,
        sessionId: 's-1',
        messageId: 'm-1',
        mentionKind: 'agent-citation',
      })

      const after = findEntryById(db, entry.id)
      expect(after?.lastMentionedAt).toBeInstanceOf(Date)
      expect(countMentionsForEntry(db, entry.id)).toBe(1)
    })
  })
})

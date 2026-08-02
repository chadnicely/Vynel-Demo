import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { createMemoryEntry } from './create-memory-entry.js'
import { listMemoryTagsForEntries } from '../repositories/index.js'
import { MEMORY_ENTRY_CREATED } from '../memory-events.js'

describe('createMemoryEntry', () => {
  it('persists normalized tags in the same transaction', async () => {
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

      const entry = createMemoryEntry(db, {
        userId: user.id,
        workspaceId: workspace.id,
        kind: 'note',
        body: 'Standing supplier terms: net 30.',
        category: 'memory',
        section: 'ops',
        createdSource: 'user-manual',
        tags: ['  Context ', 'Suppliers', 'context'],
      })

      expect(listMemoryTagsForEntries(db, [entry.id]).get(entry.id)).toEqual([
        'context',
        'suppliers',
      ])
    })
  })

  it('persists the entry with null embedding + publishes a memory.entry-created outbox event', async () => {
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

      const entry = createMemoryEntry(db, {
        userId: user.id,
        workspaceId: workspace.id,
        kind: 'person',
        title: 'Sarah Chen',
        body: 'Head of partnerships at Acme.',
        category: 'memory',
        section: 'Key contacts',
        createdSource: 'user-manual',
      })

      expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(entry.kind).toBe('person')
      expect(entry.title).toBe('Sarah Chen')
      expect(entry.embedding).toBeNull()
      expect(entry.lastMentionedAt).toBeNull()

      const events = listOutboxEventsByType(db, MEMORY_ENTRY_CREATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        entryId: entry.id,
        kind: 'person',
        category: 'memory',
        section: 'Key contacts',
        createdSource: 'user-manual',
      })
    })
  })

  it('derives a title from the body when none supplied', async () => {
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

      const entry = createMemoryEntry(db, {
        userId: user.id,
        workspaceId: workspace.id,
        kind: 'note',
        body: 'A short note. Some context.',
        category: 'memory',
        section: 'Things to remember',
        createdSource: 'user-manual',
      })

      expect(entry.title).toBe('A short note.')
    })
  })

  // A GLOBAL memory belongs to the PERSON, not to any workspace — it anchors
  // on no workspace at all, and the outbox event says so rather than naming
  // some arbitrary room.
  it('creates a user-level entry with no workspace anchor', async () => {
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

      const entry = createMemoryEntry(db, {
        userId: user.id,
        workspaceId: null,
        kind: 'note',
        body: 'I prefer plain language over jargon.',
        category: 'memory',
        section: 'Notes',
        createdSource: 'user-manual',
        tags: ['preference'],
      })

      expect(entry.workspaceId).toBeNull()
      expect(listMemoryTagsForEntries(db, [entry.id]).get(entry.id)).toEqual(['preference'])

      const events = listOutboxEventsByType(db, MEMORY_ENTRY_CREATED)
      expect(events).toHaveLength(1)
      expect((events[0]!.payload as { workspaceId: string | null }).workspaceId).toBeNull()
    })
  })
})

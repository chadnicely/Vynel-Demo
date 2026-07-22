// Shared test seeds for the journal core + route tests. Mirrors tasks'
// `test-support.ts` (seed helpers; the production barrel keeps repositories
// internal, so route/integration tests seed through here).

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { NewJournalEntry } from './repositories/index.js'

export { insertJournalEntry } from './repositories/index.js'
export type { NewJournalEntry } from './repositories/index.js'

export function seedUserWorkspace(db: Database): { userId: string; workspaceId: string } {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
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
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { userId: user.id, workspaceId: workspace.id }
}

export function makeJournalEntry(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewJournalEntry> = {},
): NewJournalEntry {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    entryDate: '2026-07-23',
    content: 'Shipped the newsletter draft; waiting on photo picks.',
    source: 'assistant',
    sessionId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

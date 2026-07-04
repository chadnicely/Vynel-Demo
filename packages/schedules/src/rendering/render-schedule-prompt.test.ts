import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import { renderSchedulePrompt } from './render-schedule-prompt.js'

function seed(db: Database) {
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
  return { user, workspace }
}

describe('renderSchedulePrompt', () => {
  it('substitutes user/workspace/now placeholders and passes unknown ones through', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const out = renderSchedulePrompt(db, {
        promptTemplate:
          'Hi {{user.displayName}} — your {{workspace.kindReadable}} ({{workspace.name}}). {{unknown.thing}}',
        userId: user.id,
        workspaceId: workspace.id,
        now: new Date('2026-06-05T09:00:00Z'),
      })
      expect(out).toContain('Hi Dana')
      expect(out).toContain('your business (Bakery)') // small-business → "business"
      expect(out).toContain('{{unknown.thing}}') // unknown placeholders pass through unchanged
    })
  })

  it('renders empty strings for a missing user/workspace without throwing', async () => {
    await withTestDatabase(async (db) => {
      const out = renderSchedulePrompt(db, {
        promptTemplate: 'Hi {{user.displayName}}.',
        userId: randomUUID(),
        workspaceId: randomUUID(),
        now: new Date(),
      })
      expect(out).toBe('Hi .')
    })
  })
})

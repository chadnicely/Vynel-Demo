// Shared test seeds for the features core + route tests. Mirrors phases'
// `test-support.ts` (seed helpers; the production barrel keeps repositories
// internal, so route/integration tests seed through here).

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { NewFeature } from './repositories/index.js'

export { insertFeature } from './repositories/index.js'
export type { NewFeature } from './repositories/index.js'

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

export function makeFeature(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewFeature> = {},
): NewFeature {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    title: 'Online ordering',
    description: 'Customers browse the menu, build a basket, and pay online.',
    phaseId: null,
    status: 'open',
    sessionId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

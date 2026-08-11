// Shared test seeds for the phases core + route tests. Mirrors plans'
// `test-support.ts` (seed helpers; the production barrel keeps repositories
// internal, so route/integration tests seed through here).

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { NewPhase } from './repositories/index.js'

export { insertPhase } from './repositories/index.js'
export type { NewPhase } from './repositories/index.js'

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

export function makePhase(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewPhase> = {},
): NewPhase {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    title: 'Phase 1 — Foundations',
    description: 'Set up the storefront skeleton: routing, layout, and the product catalog.',
    orderIndex: 0,
    status: 'open',
    sessionId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

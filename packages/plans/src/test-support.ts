// Shared test seeds for the plans core + route tests. Mirrors tasks'
// `test-support.ts` (seed helpers; the production barrel keeps repositories
// internal, so route/integration tests seed through here).

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { NewPlan } from './repositories/index.js'

export { insertPlan } from './repositories/index.js'
export type { NewPlan } from './repositories/index.js'

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

export function makePlan(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewPlan> = {},
): NewPlan {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    title: 'Ship the spring campaign',
    detail: null,
    planDate: '2026-07-23',
    status: 'open',
    source: 'assistant',
    sessionId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

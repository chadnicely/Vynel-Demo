// Shared test seeds for the apps core + route tests (the tasks/asks
// precedent; the production barrel keeps repositories internal).

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { NewWorkspaceApp } from './repositories/index.js'

export { insertApp, findAppById } from './repositories/index.js'
export type { NewWorkspaceApp } from './repositories/index.js'

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

export function makeApp(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewWorkspaceApp> = {},
): NewWorkspaceApp {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    name: 'Web app',
    command: 'pnpm --filter web dev',
    cwdRelative: '',
    port: 8999,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

// Shared test helpers for the knowledge core tests. Underscore-
// prefix mirrors the _shared / _components convention — this file
// holds test-only utilities consumed by sibling .test.ts files.
// Kept narrow: seed-a-user-and-workspace is the universal need;
// per-test fixtures stay in the test file that uses them.

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { withTestDatabase } from '@vynel/testing'

export function seedUserAndWorkspace(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  workspaceLocation: string,
) {
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
    path: workspaceLocation,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

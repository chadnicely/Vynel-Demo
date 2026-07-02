// Shared test helpers for the knowledge core tests. Underscore-
// prefix mirrors the _shared / _components convention — this file
// holds test-only utilities consumed by sibling .test.ts files.
// Kept narrow: seed-a-user-and-workspace is the universal need;
// per-test fixtures stay in the test file that uses them.

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertKnowledgeSource, type KnowledgeSourceRow } from './repositories/index.js'
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

// Seed user → workspace → a 'workspace'-scoped source rooted at `absolutePath`.
// The source is what indexing keys off now (indexFile/indexSource take a source).
export function seedUserWorkspaceAndSource(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  absolutePath: string,
) {
  const { user, workspace } = seedUserAndWorkspace(db, absolutePath)
  const now = new Date()
  const source: KnowledgeSourceRow = {
    id: randomUUID(),
    userId: user.id,
    workspaceId: workspace.id,
    scope: 'workspace',
    absolutePath,
    createdAt: now,
    updatedAt: now,
  }
  insertKnowledgeSource(db, source)
  return { user, workspace, source }
}

// Local test helpers for the files-domain core ops. NOT exported from
// `packages/files/src/index.ts`. Seeds a user + workspace inside
// the test database and (optionally) sets the workspace path to a real
// temp directory so fs ops can run.
//
// Per the knowledge-domain precedent (`@vynel/knowledge`'s
// `_test-helpers.ts`) — the underscore prefix marks "domain-private,
// test-only" so the file is grep-discoverable.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'

export type SeededWorkspace = {
  userId: string
  workspaceId: string
  workspacePath: string
}

// Creates a fresh workspace directory on disk + the matching DB rows.
// Returns the ids + the on-disk root path. Caller is responsible for
// cleanup of the temp dir (most test runners use withTestDatabase's
// finally cleanup for the DB; for the temp dir, callers can either
// let it linger inside os.tmpdir() or rm it themselves).
export async function seedUserAndWorkspace(db: Database): Promise<SeededWorkspace> {
  const workspacePath = await mkdtemp(path.join(tmpdir(), 'vynel-files-test-'))
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Test User',
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
    name: 'Files Test',
    kind: 'small-business',
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { userId: user.id, workspaceId: workspace.id, workspacePath }
}

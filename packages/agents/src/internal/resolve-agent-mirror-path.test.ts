// Path resolution for the transparency mirror: the scope homes, the
// missing-workspace null, and the containment defense (an unsafe slug
// must never become a filesystem segment).

import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { ValidationError } from '@vynel/errors'
import { resolveAgentMirrorPath } from './resolve-agent-mirror-path.js'
import { withHomeDir } from './resolve-host-home-dir.js'

function seedWorkspace(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0], workspacePath: string) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: true,
    createdAt: now,
    updatedAt: now,
  })
  return insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

describe('resolveAgentMirrorPath', () => {
  it('resolves a workspace-scope mirror under the workspace .claude/agents', async () => {
    await withTestDatabase(async (db) => {
      const workspace = seedWorkspace(db, path.join('E:', 'tmp', 'acme'))
      const mirrorPath = resolveAgentMirrorPath(db, {
        scope: 'workspace',
        workspaceId: workspace.id,
        slug: 'focus-writer',
      })
      expect(mirrorPath).toBe(path.join('E:', 'tmp', 'acme', '.claude', 'agents', 'focus-writer.md'))
    })
  })

  it('resolves a user-scope mirror under the (overridable) home .claude/agents', async () => {
    await withTestDatabase(async (db) => {
      await withHomeDir(path.join('E:', 'tmp', 'home'), async () => {
        const mirrorPath = resolveAgentMirrorPath(db, {
          scope: 'user',
          workspaceId: null,
          slug: 'focus-writer',
        })
        expect(mirrorPath).toBe(
          path.join('E:', 'tmp', 'home', '.claude', 'agents', 'focus-writer.md'),
        )
      })
    })
  })

  it('returns null when the workspace row is gone (nothing to manage)', async () => {
    await withTestDatabase(async (db) => {
      const mirrorPath = resolveAgentMirrorPath(db, {
        scope: 'workspace',
        workspaceId: randomUUID(),
        slug: 'focus-writer',
      })
      expect(mirrorPath).toBeNull()
    })
  })

  it('refuses an unsafe slug (path containment defense)', async () => {
    await withTestDatabase(async (db) => {
      for (const slug of ['../evil', 'a/b', 'a\\b', 'UPPER', 'trailing-', 'dot.md', '']) {
        expect(() =>
          resolveAgentMirrorPath(db, { scope: 'user', workspaceId: null, slug }),
        ).toThrow(ValidationError)
      }
    })
  })
})

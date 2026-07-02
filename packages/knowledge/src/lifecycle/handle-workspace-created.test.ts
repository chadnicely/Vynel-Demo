import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findKnowledgeDocumentByPath } from '@vynel/db/repositories/knowledge'
import { FileWatcherService } from '../indexing/file-watcher.js'
import { handleWorkspaceCreated } from './handle-workspace-created.js'

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), 'vynel-knowledge-handle-created-'))
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('handleWorkspaceCreated', () => {
  it('starts watching the workspace + runs the initial scan', async () => {
    await withTestDatabase(async (db) => {
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
        path: workspacePath,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      // Pre-existing files on disk — handleWorkspaceCreated should
      // index them via the initial scan.
      await writeFile(path.join(workspacePath, 'README.md'), '# Hi', 'utf8')
      await writeFile(path.join(workspacePath, 'note.txt'), 'plain', 'utf8')

      const fileWatcher = new FileWatcherService(db, silentLogger)
      const result = await handleWorkspaceCreated(
        db,
        {
          workspaceId: workspace.id,
          userId: user.id,
          workspacePath,
        },
        { fileWatcher, logger: silentLogger },
      )

      expect(result.indexedCount).toBe(2)
      expect(result.failedCount).toBe(0)
      expect(findKnowledgeDocumentByPath(db, workspace.id, 'README.md')).not.toBeNull()
      expect(findKnowledgeDocumentByPath(db, workspace.id, 'note.txt')).not.toBeNull()

      await fileWatcher.stopAll()
    })
  })
})

import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { findKnowledgeSourceById } from '../repositories/index.js'
import { registerKnowledgeSource } from './register-knowledge-source.js'
import { seedUserAndWorkspace } from '../_test-helpers.js'
import type { FileWatcherService } from '../indexing/file-watcher.js'

// Stub the watcher — the op only needs startWatchingSource; avoid live chokidar.
const stubWatcher = {
  startWatchingSource: () => {},
  stopWatchingSource: async () => {},
} as unknown as FileWatcherService

describe('registerKnowledgeSource', () => {
  it('validates + inserts a workspace source and indexes its files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-src-'))
    try {
      await writeFile(path.join(dir, 'note.md'), '# Hello\n\nWorld from the source.', 'utf8')
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedUserAndWorkspace(db, dir)
        const { source, indexed } = await registerKnowledgeSource(
          db,
          { userId: user.id, workspaceId: workspace.id, scope: 'workspace', absolutePath: dir },
          { fileWatcher: stubWatcher },
        )
        expect(findKnowledgeSourceById(db, source.id)?.absolutePath).toBe(dir)
        expect(source.scope).toBe('workspace')
        expect(source.workspaceId).toBe(workspace.id)
        expect(indexed.indexedCount).toBeGreaterThan(0)
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a non-existent directory before inserting anything', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db, path.join(tmpdir(), 'x'))
      await expect(
        registerKnowledgeSource(
          db,
          {
            userId: user.id,
            workspaceId: workspace.id,
            scope: 'workspace',
            absolutePath: path.join(tmpdir(), 'does-not-exist-xyz-123'),
          },
          { fileWatcher: stubWatcher },
        ),
      ).rejects.toThrow()
    })
  })
})

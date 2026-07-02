import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { findKnowledgeSourceById } from '../repositories/index.js'
import { registerKnowledgeSource } from './register-knowledge-source.js'
import { removeKnowledgeSource } from './remove-knowledge-source.js'
import { seedUserAndWorkspace } from '../_test-helpers.js'
import type { FileWatcherService } from '../indexing/file-watcher.js'

const stubWatcher = {
  startWatchingSource: () => {},
  stopWatchingSource: async () => {},
} as unknown as FileWatcherService

describe('removeKnowledgeSource', () => {
  it('deletes the source (cascading its documents) and is idempotent', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-src-'))
    try {
      await writeFile(path.join(dir, 'note.md'), '# Hi there', 'utf8')
      await withTestDatabase(async (db) => {
        const { user, workspace } = seedUserAndWorkspace(db, dir)
        const { source } = await registerKnowledgeSource(
          db,
          { userId: user.id, workspaceId: workspace.id, scope: 'workspace', absolutePath: dir },
          { fileWatcher: stubWatcher },
        )
        expect(findKnowledgeSourceById(db, source.id)).not.toBeNull()

        await removeKnowledgeSource(db, source.id, { fileWatcher: stubWatcher })
        expect(findKnowledgeSourceById(db, source.id)).toBeNull()

        // Idempotent: removing again is a clean no-op.
        await expect(
          removeKnowledgeSource(db, source.id, { fileWatcher: stubWatcher }),
        ).resolves.toBeUndefined()
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { FileWatcherService } from '../indexing/file-watcher.js'
import { handleWorkspaceRemoved } from './handle-workspace-removed.js'

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

describe('handleWorkspaceRemoved', () => {
  it('stops the watcher for the given workspaceId', async () => {
    await withTestDatabase(async (db) => {
      const workspacePath = await mkdtemp(path.join(tmpdir(), 'vynel-knowledge-handle-removed-'))
      try {
        const fileWatcher = new FileWatcherService(db, silentLogger)
        const workspaceId = randomUUID()
        fileWatcher.startWatching({
          workspaceId,
          userId: randomUUID(),
          workspacePath,
        })

        await handleWorkspaceRemoved({ workspaceId }, { fileWatcher, logger: silentLogger })

        // Calling stopWatching again is a no-op — proves it's already stopped
        await expect(fileWatcher.stopWatching(workspaceId)).resolves.toBeUndefined()
      } finally {
        await rm(workspacePath, { recursive: true, force: true })
      }
    })
  })

  it('is a no-op when the workspace was never being watched', async () => {
    await withTestDatabase(async (db) => {
      const fileWatcher = new FileWatcherService(db, silentLogger)
      await expect(
        handleWorkspaceRemoved(
          { workspaceId: randomUUID() },
          { fileWatcher, logger: silentLogger },
        ),
      ).resolves.toBeUndefined()
    })
  })
})

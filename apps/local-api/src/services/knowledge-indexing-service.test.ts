import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pino from 'pino'

// Inline FNV-1a + L2-normalized fake (the generate-knowledge-embeddings.test
// pattern) — the real MiniLM model must not load in a unit test.
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
function inlineFakeEmbedding(text: string): Promise<Buffer> {
  let h = FNV_OFFSET
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0
    h = Math.imul(h, FNV_PRIME) >>> 0
  }
  let state = h || 1
  const f = new Float32Array(384)
  for (let i = 0; i < 384; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    f[i] = (state / 0xffffffff) * 2 - 1
  }
  let sumSq = 0
  for (let i = 0; i < f.length; i++) sumSq += f[i]! * f[i]!
  const norm = Math.sqrt(sumSq) || 1
  for (let i = 0; i < f.length; i++) f[i]! /= norm
  return Promise.resolve(Buffer.from(f.buffer))
}

vi.mock('@vynel/embeddings', () => ({
  EMBEDDING_DIMENSIONS: 384,
  EMBEDDING_BYTES: 1536,
  EMBEDDING_MODEL_VERSION: 'all-MiniLM-L6-v2/v1',
  generateEmbedding: (text: string) => inlineFakeEmbedding(text),
}))

import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { FileWatcherService } from '@vynel/knowledge'
import {
  insertKnowledgeSource,
  findKnowledgeDocumentBySourcePath,
  listKnowledgeChunksNeedingEmbedding,
} from '@vynel/knowledge/repositories'
import { startKnowledgeIndexingService } from './knowledge-indexing-service.js'

const silentLogger = pino({ level: 'silent' })

async function waitFor(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const startedAt = Date.now()
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('startKnowledgeIndexingService', () => {
  it('restores watchers for every registered source and catch-up indexes + embeds', { timeout: 20000 }, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vynel-kis-'))
    try {
      await writeFile(path.join(dir, 'note.md'), '# Written while the app was closed.', 'utf8')
      await withTestDatabase(async (db) => {
        const now = new Date()
        const user = insertUser(db, {
          id: randomUUID(),
          displayName: 'T',
          locale: 'en-US',
          timezone: 'UTC',
          hasCompletedOnboarding: true,
          createdAt: now,
          updatedAt: now,
        })
        insertWorkspace(db, {
          id: 'ws1',
          userId: user.id,
          name: 'W',
          path: dir,
          kind: 'custom',
          isArchived: false,
          lastAccessedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        insertKnowledgeSource(db, {
          id: 'src1',
          userId: user.id,
          workspaceId: 'ws1',
          scope: 'workspace',
          absolutePath: dir,
          sourceKind: 'directory',
          createdAt: now,
          updatedAt: now,
        })

        const startWatchingSource = vi.fn()
        const fakeWatcher = { startWatchingSource } as unknown as FileWatcherService

        const service = startKnowledgeIndexingService({
          db,
          logger: silentLogger,
          fileWatcher: fakeWatcher,
          embeddingIntervalMs: 200,
        })
        try {
          // The watcher came back for the pre-existing source…
          expect(startWatchingSource).toHaveBeenCalledTimes(1)
          expect(startWatchingSource.mock.calls[0]![0].id).toBe('src1')

          // …the catch-up scan indexed the file added while "the app was closed"…
          await waitFor(
            () => findKnowledgeDocumentBySourcePath(db, 'src1', 'note.md')?.parseStatus === 'parsed',
          )
          // …and the in-process embedding tick drained the pending chunks.
          await waitFor(() => listKnowledgeChunksNeedingEmbedding(db, { limit: 1 }).length === 0)
        } finally {
          service.stop()
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

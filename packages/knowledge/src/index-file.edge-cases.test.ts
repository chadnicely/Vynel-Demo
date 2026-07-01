// Edge-case tests for indexFile — skip rules (in-skipped-folder /
// too-large / unsupported-format) + file-vanished cleanup + parse
// failure. Split out from index-file.test.ts to keep both under the
// 300-line cap (structure-standard.md).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import {
  insertKnowledgeDocument,
  findKnowledgeDocumentById,
  listKnowledgeChunksForDocument,
} from '@vynel/db/repositories/knowledge'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { indexFile } from './index-file.js'
import { KNOWLEDGE_DOCUMENT_INDEXED, KNOWLEDGE_DOCUMENT_REMOVED } from './knowledge-events.js'
import { seedUserAndWorkspace } from './_test-helpers.js'

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), 'vynel-knowledge-edge-'))
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('indexFile — skip rules', () => {
  it('skips files in .vynel/ with `in-skipped-folder` reason', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db, workspacePath)
      await mkdir(path.join(workspacePath, '.vynel'), { recursive: true })
      await writeFile(path.join(workspacePath, '.vynel', 'state.md'), 'internal', 'utf8')

      const doc = await indexFile(db, {
        workspaceId: workspace.id,
        userId: user.id,
        workspacePath,
        relativePath: '.vynel/state.md',
      })

      expect(doc.parseStatus).toBe('skipped')
      expect(doc.parseErrorMessage).toBe('in-skipped-folder')
      expect(listKnowledgeChunksForDocument(db, doc.id)).toEqual([])
    })
  })

  it('skips files in Archive/ with `in-skipped-folder` reason', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db, workspacePath)
      // No need to actually create the file — skipped folders are
      // detected from the path before any fs read.
      const doc = await indexFile(db, {
        workspaceId: workspace.id,
        userId: user.id,
        workspacePath,
        relativePath: 'Archive/old.md',
      })
      expect(doc.parseStatus).toBe('skipped')
      expect(doc.parseErrorMessage).toBe('in-skipped-folder')
    })
  })

  it('skips files with unsupported extension', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db, workspacePath)
      await writeFile(path.join(workspacePath, 'image.png'), 'binary', 'utf8')

      const doc = await indexFile(db, {
        workspaceId: workspace.id,
        userId: user.id,
        workspacePath,
        relativePath: 'image.png',
      })

      expect(doc.parseStatus).toBe('skipped')
      expect(doc.parseErrorMessage).toBe('unsupported-format')
      expect(doc.documentKind).toBe('unsupported')
    })
  })
})

describe('indexFile — failure paths', () => {
  it('cleans up + throws NotFoundError when the file vanished before stat', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db, workspacePath)
      // Seed an existing row so we can verify the cleanup
      const documentId = randomUUID()
      const now = new Date()
      insertKnowledgeDocument(db, {
        id: documentId,
        userId: user.id,
        workspaceId: workspace.id,
        relativePath: 'gone.md',
        documentKind: 'markdown',
        contentHash: 'h',
        fileSizeBytes: 10,
        fileModifiedAt: now,
        chunkCount: 0,
        parseStatus: 'parsed',
        parseErrorMessage: null,
        indexedAt: now,
        createdAt: now,
        updatedAt: now,
      })

      await expect(
        indexFile(db, {
          workspaceId: workspace.id,
          userId: user.id,
          workspacePath,
          relativePath: 'gone.md',
        }),
      ).rejects.toThrow(/file/i)

      // Cleanup ran — the row is gone
      expect(findKnowledgeDocumentById(db, documentId)).toBeNull()
      // A removed event was emitted
      expect(listOutboxEventsByType(db, KNOWLEDGE_DOCUMENT_REMOVED)).toHaveLength(1)
    })
  })

  it('records `failed` status with parseErrorMessage when the parser throws', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserAndWorkspace(db, workspacePath)
      // Synthesize a "PDF" pdf-parse will reject.
      await writeFile(path.join(workspacePath, 'broken.pdf'), 'not actually a pdf', 'utf8')

      const doc = await indexFile(db, {
        workspaceId: workspace.id,
        userId: user.id,
        workspacePath,
        relativePath: 'broken.pdf',
      })

      expect(doc.parseStatus).toBe('failed')
      expect(doc.parseErrorMessage).toBeTruthy()
      expect(listOutboxEventsByType(db, KNOWLEDGE_DOCUMENT_INDEXED)).toEqual([])
    })
  })
})

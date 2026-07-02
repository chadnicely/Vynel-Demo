import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { listKnowledgeChunksForDocument } from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { indexFile } from './index-file.js'
import { KNOWLEDGE_DOCUMENT_INDEXED, KNOWLEDGE_DOCUMENT_UPDATED } from '../knowledge-events.js'
import { seedUserWorkspaceAndSource } from '../_test-helpers.js'

let workspacePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), 'vynel-knowledge-test-'))
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
})

describe('indexFile — happy path + hash skip', () => {
  it('inserts a new document + chunks + emits document-indexed event', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace, source } = seedUserWorkspaceAndSource(db, workspacePath)
      await mkdir(path.join(workspacePath, 'Notes'), { recursive: true })
      await writeFile(
        path.join(workspacePath, 'Notes', 'meeting.md'),
        '# Meeting\n\nDiscussed the roadmap with Sarah.',
        'utf8',
      )

      const doc = await indexFile(db, { source, relativePath: 'Notes/meeting.md' })

      expect(doc.parseStatus).toBe('parsed')
      expect(doc.documentKind).toBe('markdown')
      expect(doc.indexedAt).toBeInstanceOf(Date)
      expect(doc.contentHash).toHaveLength(64)
      expect(doc.chunkCount).toBeGreaterThan(0)
      expect(doc.sourceId).toBe(source.id)

      const chunks = listKnowledgeChunksForDocument(db, doc.id)
      expect(chunks.length).toBe(doc.chunkCount)
      expect(chunks[0]!.chunkText).toContain('Meeting')

      const indexed = listOutboxEventsByType(db, KNOWLEDGE_DOCUMENT_INDEXED)
      expect(indexed).toHaveLength(1)
      expect(indexed[0]!.payload).toMatchObject({
        workspaceId: workspace.id,
        userId: user.id,
        documentId: doc.id,
        relativePath: 'Notes/meeting.md',
        documentKind: 'markdown',
      })
    })
  })

  it('hash-skips when re-indexing identical content (no chunk churn, no event)', async () => {
    await withTestDatabase(async (db) => {
      const { source } = seedUserWorkspaceAndSource(db, workspacePath)
      await writeFile(path.join(workspacePath, 'note.txt'), 'Stable content.', 'utf8')

      const first = await indexFile(db, { source, relativePath: 'note.txt' })
      const firstChunks = listKnowledgeChunksForDocument(db, first.id)
      const firstChunkIds = new Set(firstChunks.map((c) => c.id))

      const second = await indexFile(db, { source, relativePath: 'note.txt' })

      expect(second.id).toBe(first.id)
      expect(second.contentHash).toBe(first.contentHash)
      const secondChunks = listKnowledgeChunksForDocument(db, second.id)
      expect(new Set(secondChunks.map((c) => c.id))).toEqual(firstChunkIds)
      expect(listOutboxEventsByType(db, KNOWLEDGE_DOCUMENT_INDEXED)).toHaveLength(1)
      expect(listOutboxEventsByType(db, KNOWLEDGE_DOCUMENT_UPDATED)).toEqual([])
    })
  })

  it('emits document-updated (not -indexed) when an existing file changes hash', async () => {
    await withTestDatabase(async (db) => {
      const { source } = seedUserWorkspaceAndSource(db, workspacePath)
      await writeFile(path.join(workspacePath, 'note.txt'), 'Version one.', 'utf8')

      await indexFile(db, { source, relativePath: 'note.txt' })
      await writeFile(path.join(workspacePath, 'note.txt'), 'Version two — different content.', 'utf8')
      const second = await indexFile(db, { source, relativePath: 'note.txt' })

      expect(second.parseStatus).toBe('parsed')
      expect(listOutboxEventsByType(db, KNOWLEDGE_DOCUMENT_INDEXED)).toHaveLength(1)
      expect(listOutboxEventsByType(db, KNOWLEDGE_DOCUMENT_UPDATED)).toHaveLength(1)
    })
  })
})

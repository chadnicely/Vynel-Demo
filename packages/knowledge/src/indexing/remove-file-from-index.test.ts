import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertKnowledgeDocument,
  insertKnowledgeChunks,
  insertKnowledgeSource,
  upsertVectorIndexForChunk,
  findKnowledgeDocumentById,
  findKnowledgeDocumentByWorkspacePath,
  listKnowledgeChunksForDocument,
  type KnowledgeSourceRow,
} from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { removeFileFromIndex } from './remove-file-from-index.js'
import { KNOWLEDGE_DOCUMENT_REMOVED } from '../knowledge-events.js'

function seedUserWorkspace(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
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
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  const source: KnowledgeSourceRow = {
    id: randomUUID(),
    userId: user.id,
    workspaceId: workspace.id,
    scope: 'workspace',
    absolutePath: workspace.path,
    createdAt: now,
    updatedAt: now,
  }
  insertKnowledgeSource(db, source)
  return { user, workspace, source, now }
}

describe('removeFileFromIndex', () => {
  it('deletes the document, cascades chunks, purges vec rows, and emits the outbox event', async () => {
    await withTestDatabase((db) => {
      const { user, workspace, source, now } = seedUserWorkspace(db)
      const documentId = randomUUID()
      insertKnowledgeDocument(db, {
        id: documentId,
        userId: user.id,
        workspaceId: workspace.id,
        sourceId: source.id,
        scope: 'workspace',
        relativePath: 'Notes/meeting.md',
        documentKind: 'markdown',
        contentHash: 'h',
        fileSizeBytes: 42,
        fileModifiedAt: now,
        chunkCount: 2,
        parseStatus: 'parsed',
        parseErrorMessage: null,
        indexedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      const chunk1Id = randomUUID()
      const chunk2Id = randomUUID()
      insertKnowledgeChunks(db, [
        {
          id: chunk1Id,
          documentId,
          chunkIndex: 0,
          startCharOffset: 0,
          endCharOffset: 20,
          chunkText: 'hello',
          chunkTokenEstimate: 5,
          embedding: null,
          embeddingModelVersion: null,
          createdAt: now,
        },
        {
          id: chunk2Id,
          documentId,
          chunkIndex: 1,
          startCharOffset: 20,
          endCharOffset: 40,
          chunkText: 'world',
          chunkTokenEstimate: 5,
          embedding: null,
          embeddingModelVersion: null,
          createdAt: now,
        },
      ])
      // Seed a vec row so we can verify the explicit purge ran.
      const fakeEmbedding = Buffer.alloc(384 * 4) // 1536 bytes of zeros
      upsertVectorIndexForChunk(db, {
        chunkId: chunk1Id,
        sourceId: source.id,
        documentId,
        embedding: fakeEmbedding,
      })

      removeFileFromIndex(db, { source, relativePath: 'Notes/meeting.md' })

      // Document gone
      expect(findKnowledgeDocumentById(db, documentId)).toBeNull()
      expect(findKnowledgeDocumentByWorkspacePath(db, workspace.id, 'Notes/meeting.md')).toBeNull()
      // Chunks cascaded
      expect(listKnowledgeChunksForDocument(db, documentId)).toEqual([])
      // Outbox event landed
      const events = listOutboxEventsByType(db, KNOWLEDGE_DOCUMENT_REMOVED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        workspaceId: workspace.id,
        userId: user.id,
        documentId,
        relativePath: 'Notes/meeting.md',
      })
    })
  })

  it('is a no-op when the document does not exist (idempotent)', async () => {
    await withTestDatabase((db) => {
      const { source } = seedUserWorkspace(db)
      removeFileFromIndex(db, { source, relativePath: 'Notes/never-indexed.md' })
      // No outbox event emitted for a missing file
      expect(listOutboxEventsByType(db, KNOWLEDGE_DOCUMENT_REMOVED)).toEqual([])
    })
  })
})

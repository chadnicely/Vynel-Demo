import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NotFoundError } from '@vynel/errors'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertKnowledgeDocument,
  insertKnowledgeChunks,
  insertKnowledgeSource,
  type KnowledgeSourceRow,
} from '../repositories/index.js'
import { getDocumentDetail } from './get-document-detail.js'

function seedWorld(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
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
  return { user, workspace, source }
}

describe('getDocumentDetail', () => {
  it('returns the document + its chunks in chunkIndex order', () => {
    return withTestDatabase((db) => {
      const { user, workspace, source } = seedWorld(db)
      const now = new Date()
      const documentId = randomUUID()
      insertKnowledgeDocument(db, {
        id: documentId,
        userId: user.id,
        workspaceId: workspace.id,
        sourceId: source.id,
        scope: 'workspace',
        relativePath: 'Notes/a.md',
        documentKind: 'markdown',
        contentHash: 'h',
        fileSizeBytes: 100,
        fileModifiedAt: now,
        chunkCount: 2,
        parseStatus: 'parsed',
        parseErrorMessage: null,
        indexedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      // Insert in reverse chunkIndex order to verify the repo sorts.
      insertKnowledgeChunks(db, [
        {
          id: randomUUID(),
          documentId,
          chunkIndex: 1,
          startCharOffset: 100,
          endCharOffset: 200,
          chunkText: 'second',
          chunkTokenEstimate: 25,
          embedding: null,
          embeddingModelVersion: null,
          createdAt: now,
        },
        {
          id: randomUUID(),
          documentId,
          chunkIndex: 0,
          startCharOffset: 0,
          endCharOffset: 100,
          chunkText: 'first',
          chunkTokenEstimate: 25,
          embedding: null,
          embeddingModelVersion: null,
          createdAt: now,
        },
      ])

      const detail = getDocumentDetail(db, documentId)
      expect(detail.document.id).toBe(documentId)
      expect(detail.chunks).toHaveLength(2)
      expect(detail.chunks.map((c) => c.chunkText)).toEqual(['first', 'second'])
    })
  })

  it('throws NotFoundError when the document does not exist', () => {
    return withTestDatabase((db) => {
      const missingId = randomUUID()
      expect(() => getDocumentDetail(db, missingId)).toThrow(NotFoundError)
      expect(() => getDocumentDetail(db, missingId)).toThrow(/knowledge-document/)
    })
  })
})

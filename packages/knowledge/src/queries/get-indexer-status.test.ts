import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertKnowledgeDocument,
  insertKnowledgeChunks,
  insertKnowledgeSource,
  type KnowledgeSourceRow,
} from '@vynel/db/repositories/knowledge'
import { getIndexerStatus } from './get-indexer-status.js'

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

function insertDoc(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  source: KnowledgeSourceRow,
  parseStatus: 'pending' | 'parsing' | 'parsed' | 'failed' | 'skipped',
  indexedAt: Date | null,
) {
  const now = new Date()
  const id = randomUUID()
  insertKnowledgeDocument(db, {
    id,
    userId: source.userId,
    workspaceId: source.workspaceId,
    sourceId: source.id,
    scope: 'workspace',
    relativePath: `doc-${id.slice(0, 8)}.md`,
    documentKind: 'markdown',
    contentHash: 'h',
    fileSizeBytes: 100,
    fileModifiedAt: now,
    chunkCount: 0,
    parseStatus,
    parseErrorMessage: null,
    indexedAt,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

describe('getIndexerStatus', () => {
  it('returns zero counts + null lastIndexedAt for an empty workspace', () => {
    return withTestDatabase((db) => {
      const { workspace } = seedWorld(db)
      const status = getIndexerStatus(db, workspace.id)
      expect(status).toEqual({
        workspaceId: workspace.id,
        totalDocuments: 0,
        parsedDocuments: 0,
        pendingDocuments: 0,
        parsingDocuments: 0,
        failedDocuments: 0,
        skippedDocuments: 0,
        unindexedChunks: 0,
        lastIndexedAt: null,
      })
    })
  })

  it('rolls up counts across all 5 parse states + reports lastIndexedAt', () => {
    return withTestDatabase((db) => {
      const { workspace, source } = seedWorld(db)
      insertDoc(db, source, 'parsed', new Date('2026-05-25T10:00:00Z'))
      insertDoc(db, source, 'parsed', new Date('2026-05-25T11:00:00Z'))
      insertDoc(db, source, 'pending', null)
      insertDoc(db, source, 'parsing', null)
      insertDoc(db, source, 'failed', null)
      insertDoc(db, source, 'skipped', null)

      const status = getIndexerStatus(db, workspace.id)
      expect(status.totalDocuments).toBe(6)
      expect(status.parsedDocuments).toBe(2)
      expect(status.pendingDocuments).toBe(1)
      expect(status.parsingDocuments).toBe(1)
      expect(status.failedDocuments).toBe(1)
      expect(status.skippedDocuments).toBe(1)
      expect(status.lastIndexedAt?.toISOString()).toBe('2026-05-25T11:00:00.000Z')
    })
  })

  it('counts unindexedChunks from the chunks repo', () => {
    return withTestDatabase((db) => {
      const { workspace, source } = seedWorld(db)
      const docId = insertDoc(db, source, 'parsed', new Date())
      const now = new Date()
      insertKnowledgeChunks(db, [
        {
          id: randomUUID(),
          documentId: docId,
          chunkIndex: 0,
          startCharOffset: 0,
          endCharOffset: 10,
          chunkText: 'a',
          chunkTokenEstimate: 5,
          embedding: null, // unindexed
          embeddingModelVersion: null,
          createdAt: now,
        },
        {
          id: randomUUID(),
          documentId: docId,
          chunkIndex: 1,
          startCharOffset: 10,
          endCharOffset: 20,
          chunkText: 'b',
          chunkTokenEstimate: 5,
          embedding: Buffer.alloc(1536), // indexed
          embeddingModelVersion: 'fake/v1',
          createdAt: now,
        },
      ])

      const status = getIndexerStatus(db, workspace.id)
      expect(status.unindexedChunks).toBe(1)
    })
  })
})

// Response serializers — row shape → response shape. Date columns
// emit as ISO strings; the binary `embedding` Buffer is masked to
// `embeddingPresent: boolean` for the HTTP boundary (same pattern as
// memory's serializers — the binary payload is internal-only).
// Per blueprint §9.3.

import type { KnowledgeDocumentRow, KnowledgeChunkRow } from '@vynel/db/schema/knowledge'
import type { IndexerStatus, SearchKnowledgeResult } from '@vynel/core/knowledge'

export type SerializedKnowledgeDocument = {
  id: string
  userId: string
  workspaceId: string
  relativePath: string
  documentKind: KnowledgeDocumentRow['documentKind']
  contentHash: string
  fileSizeBytes: number
  fileModifiedAt: string
  chunkCount: number
  parseStatus: KnowledgeDocumentRow['parseStatus']
  parseErrorMessage: string | null
  indexedAt: string | null
  createdAt: string
  updatedAt: string
}

export function serializeDocument(doc: KnowledgeDocumentRow): SerializedKnowledgeDocument {
  return {
    id: doc.id,
    userId: doc.userId,
    workspaceId: doc.workspaceId,
    relativePath: doc.relativePath,
    documentKind: doc.documentKind,
    contentHash: doc.contentHash,
    fileSizeBytes: doc.fileSizeBytes,
    fileModifiedAt: doc.fileModifiedAt.toISOString(),
    chunkCount: doc.chunkCount,
    parseStatus: doc.parseStatus,
    parseErrorMessage: doc.parseErrorMessage,
    indexedAt: doc.indexedAt ? doc.indexedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

export type SerializedKnowledgeChunk = {
  id: string
  documentId: string
  workspaceId: string
  chunkIndex: number
  startCharOffset: number
  endCharOffset: number
  chunkText: string
  chunkTokenEstimate: number
  embeddingPresent: boolean
  embeddingModelVersion: string | null
  createdAt: string
}

export function serializeChunk(chunk: KnowledgeChunkRow): SerializedKnowledgeChunk {
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    workspaceId: chunk.workspaceId,
    chunkIndex: chunk.chunkIndex,
    startCharOffset: chunk.startCharOffset,
    endCharOffset: chunk.endCharOffset,
    chunkText: chunk.chunkText,
    chunkTokenEstimate: chunk.chunkTokenEstimate,
    embeddingPresent: chunk.embedding !== null,
    embeddingModelVersion: chunk.embeddingModelVersion,
    createdAt: chunk.createdAt.toISOString(),
  }
}

export type SerializedKnowledgeSearchResult = {
  chunkId: string
  documentId: string
  relativePath: string
  documentKind: SearchKnowledgeResult['documentKind']
  chunkIndex: number
  chunkText: string
  ftsScore: number | null
  semanticScore: number | null
  combinedScore: number
}

export function serializeSearchResult(
  result: SearchKnowledgeResult,
): SerializedKnowledgeSearchResult {
  // Search-result shape passes straight through — the FTS5 snippet
  // already carries literal <mark> tokens that the UI splits on
  // (NEVER v-html — chat Gate-3 XSS lock).
  return {
    chunkId: result.chunkId,
    documentId: result.documentId,
    relativePath: result.relativePath,
    documentKind: result.documentKind,
    chunkIndex: result.chunkIndex,
    chunkText: result.chunkText,
    ftsScore: result.ftsScore,
    semanticScore: result.semanticScore,
    combinedScore: result.combinedScore,
  }
}

export type SerializedIndexerStatus = {
  workspaceId: string
  totalDocuments: number
  parsedDocuments: number
  pendingDocuments: number
  parsingDocuments: number
  failedDocuments: number
  skippedDocuments: number
  unindexedChunks: number
  lastIndexedAt: string | null
}

export function serializeIndexerStatus(status: IndexerStatus): SerializedIndexerStatus {
  return {
    workspaceId: status.workspaceId,
    totalDocuments: status.totalDocuments,
    parsedDocuments: status.parsedDocuments,
    pendingDocuments: status.pendingDocuments,
    parsingDocuments: status.parsingDocuments,
    failedDocuments: status.failedDocuments,
    skippedDocuments: status.skippedDocuments,
    unindexedChunks: status.unindexedChunks,
    lastIndexedAt: status.lastIndexedAt ? status.lastIndexedAt.toISOString() : null,
  }
}

// `indexFile` — the async core op orchestrating parse + hash-skip +
// chunk + persist for a single file within a SOURCE (a registered
// directory at workspace or global scope). Load-bearing op behind both
// the FileWatcherService on every fs event and the initial source scan
// (`indexSource`).
//
// Phase 1 SYNC inside the tx; async (fs reads + parser) OUTSIDE.
// `better-sqlite3` rejects Promise-returning tx callbacks at runtime
// per the locked Phase 1 invariant
// (`.claude/memory/decisions/phase-1-sync-transactions.md`).
//
// Status lifecycle:
//   - new row inserted as `parsing`; row is "claimed" before the parser runs.
//   - parse + chunk happens OUTSIDE the tx (slow, async).
//   - on success: a second tx updates `parsed` + replaces chunks + publishes outbox.
//   - on parse failure: a third tx flips to `failed` with the error.
//
// Hash-skip: if the parsed text's SHA-256 matches what's already stored AND the
// previous status was `parsed`, only the file metadata is refreshed — no chunk
// churn, no outbox event (idempotent).
//
// Skip rules (each lands as `skipped` with the reason; no chunks, no embedding):
//   - file in `.vynel/` or `Archive/` → `in-skipped-folder`
//   - file > 50 MB → `too-large`
//   - unsupported extension → `unsupported-format`
//
// Per blueprint §6.

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import {
  findKnowledgeDocumentBySourcePath,
  findKnowledgeDocumentById,
  insertKnowledgeDocument,
  updateKnowledgeDocument,
  hardDeleteKnowledgeChunksForDocument,
  insertKnowledgeChunks,
  type KnowledgeSourceRow,
} from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { chunkParsedText, deriveDocumentKindFromPath, resolveDocumentParser } from '@vynel/indexer'
import {
  KNOWLEDGE_DOCUMENT_INDEXED,
  KNOWLEDGE_DOCUMENT_UPDATED,
  type KnowledgeDocumentIndexedPayload,
  type KnowledgeDocumentUpdatedPayload,
} from '../knowledge-events.js'
import { sourceRootFor } from '../sources/source-paths.js'
import { sha256 } from './content-hash.js'
import { removeFileFromIndex } from './remove-file-from-index.js'
import { upsertSkippedDocument } from './upsert-skipped-document.js'
import type { KnowledgeDocumentRow, StructuralLogger } from '../knowledge-types.js'

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
const SKIPPED_FOLDER_PREFIXES = ['.vynel/', 'Archive/']

export type IndexFileInput = {
  // The source (registered directory) this file belongs to — carries the
  // sourceId, scope, workspaceId (null for global), userId, and the
  // absolutePath the relativePath is resolved against.
  source: KnowledgeSourceRow
  // OS-native or already-forward-slashed; the op normalizes either.
  relativePath: string
}

export async function indexFile(
  db: Database,
  input: IndexFileInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<KnowledgeDocumentRow> {
  const { source } = input
  const normalizedRelative = input.relativePath.split(path.sep).join('/')
  // A file source roots at its parent dir (its one document keys on the
  // basename); a directory source roots at itself — source-paths.ts.
  const absolutePath = path.join(
    sourceRootFor(source),
    normalizedRelative.split('/').join(path.sep),
  )
  const now = new Date()

  if (SKIPPED_FOLDER_PREFIXES.some((p) => normalizedRelative.startsWith(p))) {
    return upsertSkippedDocument(db, input, normalizedRelative, 'in-skipped-folder', null, now)
  }

  let fileStat
  try {
    fileStat = await stat(absolutePath)
  } catch {
    // File vanished between watch event and stat — clean up any existing row +
    // signal the caller (the watcher surfaces `parse-failed`; the source scan
    // catches + counts it).
    removeFileFromIndex(db, { source, relativePath: normalizedRelative })
    throw new NotFoundError('file', normalizedRelative)
  }

  if (fileStat.size > MAX_FILE_SIZE_BYTES) {
    return upsertSkippedDocument(
      db,
      input,
      normalizedRelative,
      'too-large',
      { size: fileStat.size, mtime: fileStat.mtime },
      now,
    )
  }

  const documentKind = deriveDocumentKindFromPath(normalizedRelative)
  if (documentKind === 'unsupported') {
    return upsertSkippedDocument(
      db,
      input,
      normalizedRelative,
      'unsupported-format',
      { size: fileStat.size, mtime: fileStat.mtime },
      now,
    )
  }

  // Claim the row as `parsing` — sync tx; insert-or-update, keyed by (source, path).
  const existing = findKnowledgeDocumentBySourcePath(db, source.id, normalizedRelative)
  const documentId = existing?.id ?? randomUUID()
  withTransaction(db, (tx) => {
    if (existing) {
      updateKnowledgeDocument(tx, documentId, {
        parseStatus: 'parsing',
        fileSizeBytes: fileStat.size,
        fileModifiedAt: fileStat.mtime,
        documentKind,
      })
    } else {
      insertKnowledgeDocument(tx, {
        id: documentId,
        userId: source.userId,
        workspaceId: source.workspaceId,
        sourceId: source.id,
        scope: source.scope,
        relativePath: normalizedRelative,
        documentKind,
        contentHash: '',
        fileSizeBytes: fileStat.size,
        fileModifiedAt: fileStat.mtime,
        chunkCount: 0,
        parseStatus: 'parsing',
        parseErrorMessage: null,
        indexedAt: null,
        createdAt: now,
        updatedAt: now,
      })
    }
  })

  // Parse + hash + chunk OUTSIDE the tx.
  try {
    const parser = resolveDocumentParser(documentKind)
    if (!parser) {
      throw new Error(`indexFile: no parser for documentKind ${documentKind}`)
    }
    const parsed = await parser({ absolutePath, fileSizeBytes: fileStat.size })
    const contentHash = sha256(parsed.parsedText)

    // Hash-skip: same content as last time AND we were already parsed.
    if (existing && existing.contentHash === contentHash && existing.parseStatus === 'parsed') {
      withTransaction(db, (tx) => {
        updateKnowledgeDocument(tx, documentId, {
          parseStatus: 'parsed',
          fileSizeBytes: fileStat.size,
          fileModifiedAt: fileStat.mtime,
          indexedAt: new Date(),
        })
      })
      const row = findKnowledgeDocumentById(db, documentId)
      if (!row) throw new Error('indexFile: row vanished after hash-skip update')
      return row
    }

    const chunks = chunkParsedText({ parsedText: parsed.parsedText })

    // Replace chunks + flip to `parsed` + publish outbox events — one tx.
    withTransaction(db, (tx) => {
      hardDeleteKnowledgeChunksForDocument(tx, documentId)
      if (chunks.length > 0) {
        insertKnowledgeChunks(
          tx,
          chunks.map((chunk) => ({
            id: randomUUID(),
            documentId,
            chunkIndex: chunk.chunkIndex,
            startCharOffset: chunk.startCharOffset,
            endCharOffset: chunk.endCharOffset,
            chunkText: chunk.chunkText,
            chunkTokenEstimate: chunk.chunkTokenEstimate,
            embedding: null,
            embeddingModelVersion: null,
            createdAt: new Date(),
          })),
        )
      }
      updateKnowledgeDocument(tx, documentId, {
        contentHash,
        chunkCount: chunks.length,
        parseStatus: 'parsed',
        parseErrorMessage: null,
        indexedAt: new Date(),
      })

      const isNew = !existing
      const indexedPayload: KnowledgeDocumentIndexedPayload | KnowledgeDocumentUpdatedPayload = {
        workspaceId: source.workspaceId,
        userId: source.userId,
        documentId,
        relativePath: normalizedRelative,
        documentKind,
        chunkCount: chunks.length,
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: isNew ? KNOWLEDGE_DOCUMENT_INDEXED : KNOWLEDGE_DOCUMENT_UPDATED,
        payload: indexedPayload,
        createdAt: new Date(),
        processedAt: null,
      })
    })

    const row = findKnowledgeDocumentById(db, documentId)
    if (!row) throw new Error('indexFile: row vanished after parsed update')
    return row
  } catch (err) {
    deps.logger?.warn(
      { err, relativePath: normalizedRelative, sourceId: source.id },
      'indexFile: parse failed',
    )
    withTransaction(db, (tx) => {
      updateKnowledgeDocument(tx, documentId, {
        parseStatus: 'failed',
        parseErrorMessage: err instanceof Error ? err.message : String(err),
      })
    })
    const row = findKnowledgeDocumentById(db, documentId)
    if (!row) throw new Error('indexFile: row vanished after failure update')
    return row
  }
}

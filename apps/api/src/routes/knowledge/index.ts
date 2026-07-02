// The `knowledge` HTTP surface — 5 routes mounted under
// `/workspaces/:workspaceId/knowledge` from `apps/api/src/app.ts`:
//
//   GET  /documents              -> listDocumentsForWorkspace   [x-mcp: list_knowledge_documents]
//   GET  /documents/:documentId  -> getDocumentDetail           [x-mcp: get_knowledge_document]
//   GET  /search                 -> searchKnowledge             [x-mcp: search_knowledge]
//   GET  /status                 -> getIndexerStatus            [x-mcp: get_indexer_status]
//   POST /reindex                -> forceReindexWorkspace       (no x-mcp — mutating per D16)
//
// Locked Hono protocol per `coding-standard.md` "Hono routes" +
// describeRoute (from the local openapi.js wrapper — widens the type
// for x-mcp + x-sdk-name) → validator (from hono-openapi/zod) →
// `...workspaceScoped` → handler. Chained methods on
// `factory.createApp()`.
//
// MCP exposure per D16: 4 safe-read GETs (memory D21 + chat D26
// default-expose); POST /reindex stays NOT exposed (mutating;
// sdk-mcp.md safe-by-default).

import { validator } from 'hono-openapi/zod'
import { NotFoundError } from '@vynel/core/errors'
import {
  forceReindexWorkspace,
  getDocumentDetail,
  getIndexerStatus,
  listDocumentsForWorkspace,
  searchKnowledge,
} from '@vynel/core/knowledge'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  ListKnowledgeDocumentsQuerySchema,
  SearchKnowledgeQuerySchema,
  KnowledgeDocumentParamSchema,
  DocumentKindSchema,
} from './schemas.js'
import {
  serializeChunk,
  serializeDocument,
  serializeIndexerStatus,
  serializeSearchResult,
} from './serializers.js'

const VALID_DOCUMENT_KINDS = DocumentKindSchema.options

export const knowledgeApp = factory
  .createApp()
  // ──────────────────────────────────────────────────────────────────
  // GET /documents — list (workspace-scoped, cursor-paginated, x-mcp)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/documents',
    describeRoute({
      tags: ['knowledge'],
      summary: 'List indexed documents for the active workspace.',
      'x-sdk-name': 'knowledge.listDocuments',
      responses: {
        200: { description: '{ documents: SerializedKnowledgeDocument[], nextCursor }.' },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_knowledge_documents',
        description:
          'List indexed knowledge documents for the active workspace (owner-scoped — only the ' +
          "authenticated user's documents). Supports filtering by documentKind " +
          '(markdown / plain-text / pdf / docx / html / csv / json), or by an exact ' +
          '`path` (workspace-relative) to fetch the single matching document. Cursor-paginated ' +
          'by (indexedAt DESC NULLS LAST, id DESC). Read-only.',
      },
    }),
    validator('query', ListKnowledgeDocumentsQuerySchema),
    ...workspaceScoped,
    async (c) => {
      const q = c.req.valid('query')
      const input: Parameters<typeof listDocumentsForWorkspace>[1] = {
        workspaceId: c.var.workspace!.id,
      }
      if (q.path !== undefined) input.path = q.path
      if (q.documentKind !== undefined) input.documentKind = q.documentKind
      if (q.limit !== undefined) input.limit = q.limit
      if (q.cursorId !== undefined) {
        input.cursor = {
          indexedAt: q.cursorIndexedAt ?? null,
          id: q.cursorId,
        }
      }
      const { documents, nextCursor } = listDocumentsForWorkspace(c.var.db, input)
      return c.json({ documents: documents.map(serializeDocument), nextCursor })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /documents/:documentId — detail (document + chunks, x-mcp)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/documents/:documentId',
    describeRoute({
      tags: ['knowledge'],
      summary: 'Get one knowledge document + its chunks (workspace-scoped).',
      'x-sdk-name': 'knowledge.getDocument',
      responses: {
        200: {
          description:
            '{ document: SerializedKnowledgeDocument, chunks: SerializedKnowledgeChunk[] }.',
        },
        404: { description: 'Knowledge document not found in this workspace.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_knowledge_document',
        description:
          'Get one knowledge document by id, along with its parsed chunks. ' +
          'Owner-scoped — returns 404 if the document does not belong to the active workspace. ' +
          'The chunks carry character offsets + token estimates; the chunkText is the ' +
          'parsed-and-normalized content used for both FTS and semantic search. Read-only.',
      },
    }),
    validator('param', KnowledgeDocumentParamSchema),
    ...workspaceScoped,
    async (c) => {
      const { documentId } = c.req.valid('param')
      const detail = getDocumentDetail(c.var.db, documentId)
      if (detail.document.workspaceId !== c.var.workspace!.id) {
        throw new NotFoundError('knowledge-document', documentId)
      }
      return c.json({
        document: serializeDocument(detail.document),
        chunks: detail.chunks.map(serializeChunk),
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /search — hybrid (FTS5 + sqlite-vec; default mode = hybrid, x-mcp)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/search',
    describeRoute({
      tags: ['knowledge'],
      summary: 'Search knowledge chunks (FTS5, semantic, or hybrid).',
      'x-sdk-name': 'knowledge.search',
      responses: {
        200: { description: '{ results: SerializedKnowledgeSearchResult[] }.' },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'search_knowledge',
        description:
          "Search the workspace's indexed documents by text query. " +
          'Mode: "fts" (FTS5 keyword), "semantic" (sqlite-vec cosine over MiniLM-L6-v2 embeddings), ' +
          'or "hybrid" (default; Reciprocal Rank Fusion k=60). ' +
          'Returns up to `limit` matching chunks with FTS snippet (literal <mark> tokens) + scores. ' +
          'Optional documentKindFilter is a comma-separated list of document kinds to restrict to. ' +
          'Owner-scoped. Read-only.',
      },
    }),
    validator('query', SearchKnowledgeQuerySchema),
    ...workspaceScoped,
    async (c) => {
      const q = c.req.valid('query')
      const input: Parameters<typeof searchKnowledge>[1] = {
        workspaceId: c.var.workspace!.id,
        query: q.query,
      }
      if (q.mode !== undefined) input.mode = q.mode
      if (q.limit !== undefined) input.limit = q.limit
      if (q.documentKindFilter !== undefined && q.documentKindFilter.length > 0) {
        const candidates = q.documentKindFilter.split(',').map((s) => s.trim())
        const filter = candidates.filter((k): k is (typeof VALID_DOCUMENT_KINDS)[number] =>
          (VALID_DOCUMENT_KINDS as readonly string[]).includes(k),
        )
        if (filter.length > 0) input.documentKindFilter = filter
      }
      const results = await searchKnowledge(c.var.db, input)
      return c.json({ results: results.map(serializeSearchResult) })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /status — indexer status counts + lastIndexedAt (x-mcp)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/status',
    describeRoute({
      tags: ['knowledge'],
      summary: 'Get the indexer status for the active workspace.',
      'x-sdk-name': 'knowledge.getStatus',
      responses: {
        200: { description: 'SerializedIndexerStatus.' },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_indexer_status',
        description:
          'Return the indexer status for the active workspace: total documents, per-parse-state ' +
          'counts (parsed / pending / parsing / failed / skipped), the count of chunks awaiting ' +
          'embedding generation, and the most recent indexed-at timestamp. Read-only.',
      },
    }),
    ...workspaceScoped,
    async (c) => {
      const status = getIndexerStatus(c.var.db, c.var.workspace!.id)
      return c.json(serializeIndexerStatus(status))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /reindex — flips every document to `pending` then re-scans
  // No x-mcp — mutating per sdk-mcp.md safe-by-default + D16.
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/reindex',
    describeRoute({
      tags: ['knowledge'],
      summary: 'Force-reindex every document in the active workspace.',
      'x-sdk-name': 'knowledge.reindex',
      responses: {
        200: { description: '{ indexedCount, skippedCount, failedCount }.' },
        404: { description: 'Workspace not found.' },
      },
    }),
    ...workspaceScoped,
    async (c) => {
      const result = await forceReindexWorkspace(c.var.db, {
        workspaceId: c.var.workspace!.id,
        userId: c.var.user.id,
        workspacePath: c.var.workspace!.path,
      })
      return c.json(result)
    },
  )

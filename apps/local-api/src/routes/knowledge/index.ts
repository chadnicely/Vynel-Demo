// The `knowledge` HTTP surface — 5 routes mounted under
// `/workspaces/:workspaceId/knowledge` from `apps/local-api/src/app.ts`:
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

import { resolver, validator } from 'hono-openapi/zod'
import { NotFoundError } from '@vynel/errors'
import {
  forceReindexWorkspace,
  getDocumentDetail,
  getIndexerStatus,
  listDocumentsForWorkspace,
  searchKnowledge,
  registerKnowledgeSource,
  removeKnowledgeSource,
  listKnowledgeSources,
  summarizeKnowledgeDocumentsBySource,
} from '@vynel/knowledge'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  ListKnowledgeDocumentsQuerySchema,
  SearchKnowledgeQuerySchema,
  KnowledgeDocumentParamSchema,
  DocumentKindSchema,
  ListKnowledgeDocumentsResponseSchema,
  KnowledgeDocumentDetailResponseSchema,
  SearchKnowledgeResponseSchema,
  IndexerStatusSchema,
  ReindexResponseSchema,
  AddDirectoryBodySchema,
  KnowledgeSourceParamSchema,
  AddDirectoryResponseSchema,
  ListKnowledgeSourcesResponseSchema,
  RemoveKnowledgeSourceResponseSchema,
} from './schemas.js'
import {
  serializeChunk,
  serializeDocument,
  serializeIndexerStatus,
  serializeSearchResult,
  serializeSource,
  serializeSourceListItem,
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
        200: {
          description: '{ documents: SerializedKnowledgeDocument[], nextCursor }.',
          content: { 'application/json': { schema: resolver(ListKnowledgeDocumentsResponseSchema) } },
        },
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
      return c.json({
        documents: documents.map((doc) => serializeDocument(doc, c.var.workspace!.id)),
        nextCursor,
      })
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
          content: { 'application/json': { schema: resolver(KnowledgeDocumentDetailResponseSchema) } },
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
        document: serializeDocument(detail.document, c.var.workspace!.id),
        chunks: detail.chunks.map((chunk) => serializeChunk(chunk, c.var.workspace!.id)),
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
        200: {
          description: '{ results: SerializedKnowledgeSearchResult[] }.',
          content: { 'application/json': { schema: resolver(SearchKnowledgeResponseSchema) } },
        },
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
        userId: c.var.user.id,
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
        200: {
          description: 'SerializedIndexerStatus.',
          content: { 'application/json': { schema: resolver(IndexerStatusSchema) } },
        },
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
        200: {
          description: '{ indexedCount, skippedCount, failedCount }.',
          content: { 'application/json': { schema: resolver(ReindexResponseSchema) } },
        },
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
  // ──────────────────────────────────────────────────────────────────
  // POST /sources — register a directory to index (add-to-knowledge).
  // Mutating MCP tool `add_to_knowledge` — auto mode (no approval card
  // yet; the card lands with the approvals/agent-turn phase).
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/sources',
    describeRoute({
      tags: ['knowledge'],
      summary: 'Register a directory or single file to index, at workspace or global scope.',
      'x-sdk-name': 'knowledge.addSource',
      responses: {
        200: {
          description: '{ source: SerializedKnowledgeSource, indexed: { indexedCount, skippedCount, failedCount } }.',
          content: { 'application/json': { schema: resolver(AddDirectoryResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'add_to_knowledge',
        mutatingApproved: true,
        description:
          'Add a directory OR a single file to the knowledge base so it is indexed for search. ' +
          '`absolutePath` is the directory or file on disk; `scope` is "workspace" (indexed for ' +
          'the active workspace) or "global" (indexed for the user across all workspaces). ' +
          'Registers the source, starts watching it for changes, and indexes it. Mutating.',
      },
    }),
    validator('json', AddDirectoryBodySchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const result = await registerKnowledgeSource(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: body.scope === 'global' ? null : c.var.workspace!.id,
          scope: body.scope,
          absolutePath: body.absolutePath,
        },
        { fileWatcher: c.var.fileWatcher, logger: c.var.logger },
      )
      return c.json({ source: serializeSource(result.source), indexed: result.indexed })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /sources — list registered sources (workspace's + user's global).
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/sources',
    describeRoute({
      tags: ['knowledge'],
      summary: "List registered knowledge sources (the workspace's + the user's global sources).",
      'x-sdk-name': 'knowledge.listSources',
      responses: {
        200: {
          description: '{ sources: SerializedKnowledgeSource[] }.',
          content: { 'application/json': { schema: resolver(ListKnowledgeSourcesResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_knowledge_sources',
        description:
          'List the registered knowledge sources in scope for the active workspace: the ' +
          "workspace's own sources plus the user's global sources. Each carries its absolute " +
          'path, scope, and timestamps. Read-only.',
      },
    }),
    ...workspaceScoped,
    async (c) => {
      const sources = listKnowledgeSources(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      const summaries = summarizeKnowledgeDocumentsBySource(
        c.var.db,
        sources.map((source) => source.id),
      )
      return c.json({
        sources: sources.map((source) => serializeSourceListItem(source, summaries.get(source.id))),
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // DELETE /sources/:sourceId — stop watching + purge the source.
  // Mutating MCP tool `remove_knowledge_source` (auto mode).
  // ──────────────────────────────────────────────────────────────────
  .delete(
    '/sources/:sourceId',
    describeRoute({
      tags: ['knowledge'],
      summary: 'Remove a registered knowledge source (stops watching; purges its docs + chunks).',
      'x-sdk-name': 'knowledge.removeSource',
      responses: {
        200: {
          description: '{ removed: boolean }.',
          content: { 'application/json': { schema: resolver(RemoveKnowledgeSourceResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'remove_knowledge_source',
        mutatingApproved: true,
        description:
          'Remove a registered knowledge source by id. Stops watching its directory and purges ' +
          'its indexed documents + chunks (cascade). Idempotent — removing an unknown id is a ' +
          'no-op. Mutating.',
      },
    }),
    validator('param', KnowledgeSourceParamSchema),
    ...workspaceScoped,
    async (c) => {
      const { sourceId } = c.req.valid('param')
      await removeKnowledgeSource(c.var.db, sourceId, {
        fileWatcher: c.var.fileWatcher,
        logger: c.var.logger,
      })
      return c.json({ removed: true })
    },
  )

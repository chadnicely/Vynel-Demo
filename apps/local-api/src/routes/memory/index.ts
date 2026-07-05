// The `memory` HTTP surface — 7 routes mounted under
// `/workspaces/:workspaceId/memory` from `apps/local-api/src/app.ts`:
//
//   GET    /entries                       -> listMemoryEntriesForWorkspace  [x-mcp]
//   GET    /search                        -> searchMemoryForAgent          [x-mcp]
//   POST   /entries                       -> createMemoryEntry             [x-mcp, mutatingApproved]
//   GET    /entries/:entryId              -> findEntryById + serialize
//   PATCH  /entries/:entryId              -> updateMemoryEntry
//   DELETE /entries/:entryId              -> deleteMemoryEntry
//   GET    /entries/:entryId/mentions     -> listRecentMentionsForEntry
//
// Locked Hono protocol: describeRoute (from the local openapi.js
// wrapper — widens the type for x-mcp + x-sdk-name) → validator (from
// hono-openapi/zod) → `...workspaceScoped` → handler. Chained methods
// on `factory.createApp()`.
//
// MCP exposure: 3 tools — 2 safe-read GETs (list_memory_entries,
// search_memory) + create_memory_entry (mutatingApproved, carried over
// from source — agent write authority with no approval-card intercept
// yet). GET /entries/:entryId, PATCH, DELETE, and GET mentions stay
// unexposed, matching source exactly.
//
// Error mapping: NONE here. Core ops throw typed `VynelError`
// subclasses; the global `onError` in `app.ts` handles them.

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  listMemoryEntriesForWorkspace,
  searchMemoryForAgent,
  createMemoryEntry,
  updateMemoryEntry,
  deleteMemoryEntry,
  findEntryById,
  listRecentMentionsForEntry,
} from '@vynel/memory'
import { NotFoundError } from '@vynel/errors'
import { serializeEntry, serializeMention, serializeSearchResult } from './serializers.js'
import {
  ListMemoryEntriesQuerySchema,
  SearchMemoryQuerySchema,
  CreateMemoryEntryBodySchema,
  UpdateMemoryEntryBodySchema,
  MemoryEntryParamSchema,
  MemoryEntrySchema,
  ListMemoryEntriesResponseSchema,
  SearchMemoryResponseSchema,
  ListMemoryEntryMentionsResponseSchema,
} from './schemas.js'

export const memoryApp = factory
  .createApp()
  // ──────────────────────────────────────────────────────────────────
  // GET /entries — list (workspace-scoped, cursor-paginated, x-mcp)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/entries',
    describeRoute({
      tags: ['memory'],
      summary: 'List memory entries for the active workspace.',
      'x-sdk-name': 'memory.list',
      responses: {
        200: {
          description: '{ entries: SerializedMemoryEntry[], nextCursor }.',
          content: { 'application/json': { schema: resolver(ListMemoryEntriesResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_memory_entries',
        description:
          'List memory entries for the active workspace (owner-scoped — only the authenticated ' +
          "user's entries). Supports filtering by kind (person / preference / business-fact / " +
          'recurring-pattern / note); cursor-paginated by (lastMentionedAt DESC NULLS LAST, id DESC). ' +
          'Archived entries are excluded unless includeArchived=true. Read-only.',
      },
    }),
    validator('query', ListMemoryEntriesQuerySchema),
    ...workspaceScoped,
    async (c) => {
      const q = c.req.valid('query')
      const cursor =
        q.cursorId !== undefined
          ? { lastMentionedAt: q.cursorLastMentionedAt ?? null, id: q.cursorId }
          : null
      const input: Parameters<typeof listMemoryEntriesForWorkspace>[1] = {
        workspaceId: c.var.workspace!.id,
        cursor,
      }
      if (q.kind !== undefined) input.kind = q.kind
      if (q.includeArchived !== undefined) input.includeArchived = q.includeArchived
      if (q.limit !== undefined) input.limit = q.limit
      const { entries, nextCursor } = listMemoryEntriesForWorkspace(c.var.db, input)
      return c.json({ entries: entries.map(serializeEntry), nextCursor })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /search — hybrid (FTS5 + sqlite-vec; default mode = hybrid, x-mcp)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/search',
    describeRoute({
      tags: ['memory'],
      summary: 'Search memory entries (FTS5, semantic, or hybrid).',
      'x-sdk-name': 'memory.search',
      responses: {
        200: {
          description: '{ results: SerializedMemorySearchResult[] }.',
          content: { 'application/json': { schema: resolver(SearchMemoryResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'search_memory',
        description:
          "Search the workspace's memory entries by text query. " +
          'Mode: "fts" (FTS5 keyword), "semantic" (sqlite-vec cosine over MiniLM-L6-v2 embeddings), ' +
          'or "hybrid" (default; Reciprocal Rank Fusion k=60). ' +
          'Returns up to `limit` results with title + body snippet (literal <mark> tokens — UI splits, NEVER v-html) + scores. ' +
          "Owner-scoped — only the authenticated user's entries. Read-only.",
      },
    }),
    validator('query', SearchMemoryQuerySchema),
    ...workspaceScoped,
    async (c) => {
      const q = c.req.valid('query')
      const input: Parameters<typeof searchMemoryForAgent>[1] = {
        workspaceId: c.var.workspace!.id,
        query: q.query,
      }
      if (q.mode !== undefined) input.mode = q.mode
      if (q.limit !== undefined) input.limit = q.limit
      const results = await searchMemoryForAgent(c.var.db, input)
      return c.json({ results: results.map(serializeSearchResult) })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /entries — manual create (createdSource = 'user-manual').
  // Carries x-mcp (create_memory_entry, mutatingApproved) — carried
  // over from source, which overrides the "safe-read GETs only" default
  // for this one write tool (agent write authority with no approval-
  // card intercept yet; the intercept stays the future-state design).
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/entries',
    describeRoute({
      tags: ['memory'],
      summary: 'Create a memory entry via the panel (user-manual provenance).',
      'x-sdk-name': 'memory.create',
      responses: {
        201: {
          description: 'SerializedMemoryEntry.',
          content: { 'application/json': { schema: resolver(MemoryEntrySchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'create_memory_entry',
        description:
          'Create a new memory entry in the active workspace. ' +
          'Use this to record information the user mentions that should persist across chat sessions — facts about people, preferences, business context, recurring patterns, or general notes. ' +
          '`kind` is one of person / preference / business-fact / recurring-pattern / note. ' +
          '`title` is optional (derived from body if omitted). ' +
          '`body` is the entry content (1-10000 chars). ' +
          '`category` is the high-level grouping the entry belongs to (user / preferences / memory). ' +
          "`section` is a sub-grouping label within that category (e.g. 'Key contacts', 'Communication style'). " +
          "Side effect: writes a row + publishes a memory.entry-created outbox event. The user's memory panel will show the new entry. Returns the created entry with id + serverside-derived title.",
        mutatingApproved: true,
      },
    }),
    validator('json', CreateMemoryEntryBodySchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const input: Parameters<typeof createMemoryEntry>[1] = {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        kind: body.kind,
        body: body.body,
        category: body.category,
        section: body.section,
        createdSource: 'user-manual',
      }
      if (body.title !== undefined) input.title = body.title
      const entry = createMemoryEntry(c.var.db, input)
      return c.json(serializeEntry(entry), 201)
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /entries/:entryId — single-entry detail
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/entries/:entryId',
    describeRoute({
      tags: ['memory'],
      summary: 'Get one memory entry by id (workspace-scoped).',
      'x-sdk-name': 'memory.get',
      responses: {
        200: {
          description: 'SerializedMemoryEntry.',
          content: { 'application/json': { schema: resolver(MemoryEntrySchema) } },
        },
        404: { description: 'Memory entry not found in this workspace.' },
      },
    }),
    validator('param', MemoryEntryParamSchema),
    ...workspaceScoped,
    async (c) => {
      const { entryId } = c.req.valid('param')
      const entry = findEntryById(c.var.db, entryId)
      if (!entry || entry.workspaceId !== c.var.workspace!.id || entry.deletedAt !== null) {
        throw new NotFoundError('memory-entry', entryId)
      }
      return c.json(serializeEntry(entry))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // PATCH /entries/:entryId — update (title / body / kind / isArchived)
  // ──────────────────────────────────────────────────────────────────
  .patch(
    '/entries/:entryId',
    describeRoute({
      tags: ['memory'],
      summary: 'Update a memory entry (title, body, kind, archive state).',
      'x-sdk-name': 'memory.update',
      responses: {
        200: {
          description: 'SerializedMemoryEntry (updated).',
          content: { 'application/json': { schema: resolver(MemoryEntrySchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'Memory entry not found.' },
      },
    }),
    validator('param', MemoryEntryParamSchema),
    validator('json', UpdateMemoryEntryBodySchema),
    ...workspaceScoped,
    async (c) => {
      const { entryId } = c.req.valid('param')
      const body = c.req.valid('json')

      // Cross-workspace guard — the core op doesn't know about workspace
      // ownership (it operates on entry ids); check here before mutating
      // to avoid a "could-edit-other-tenant" vector in Phase 2 multi-user.
      const existing = findEntryById(c.var.db, entryId)
      if (
        !existing ||
        existing.workspaceId !== c.var.workspace!.id ||
        existing.deletedAt !== null
      ) {
        throw new NotFoundError('memory-entry', entryId)
      }

      // Conditional spread per the exactOptionalPropertyTypes foot-gun —
      // Zod's optional() produces `string | undefined` but the core input
      // declares `title?: string` (present-or-absent). Pass only the
      // fields the caller sent.
      const patch: Parameters<typeof updateMemoryEntry>[2] = {}
      if (body.title !== undefined) patch.title = body.title
      if (body.body !== undefined) patch.body = body.body
      if (body.kind !== undefined) patch.kind = body.kind
      if (body.isArchived !== undefined) patch.isArchived = body.isArchived
      const updated = updateMemoryEntry(c.var.db, entryId, patch)
      return c.json(serializeEntry(updated))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // DELETE /entries/:entryId — soft-delete (30d retention)
  // ──────────────────────────────────────────────────────────────────
  .delete(
    '/entries/:entryId',
    describeRoute({
      tags: ['memory'],
      summary: 'Soft-delete a memory entry (30-day retention before hard purge).',
      'x-sdk-name': 'memory.delete',
      responses: {
        204: { description: 'Deleted (no body).' },
        404: { description: 'Memory entry not found.' },
      },
    }),
    validator('param', MemoryEntryParamSchema),
    ...workspaceScoped,
    async (c) => {
      const { entryId } = c.req.valid('param')
      const existing = findEntryById(c.var.db, entryId)
      if (
        !existing ||
        existing.workspaceId !== c.var.workspace!.id ||
        existing.deletedAt !== null
      ) {
        throw new NotFoundError('memory-entry', entryId)
      }
      deleteMemoryEntry(c.var.db, entryId)
      return c.body(null, 204)
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /entries/:entryId/mentions — recent mentions list
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/entries/:entryId/mentions',
    describeRoute({
      tags: ['memory'],
      summary: 'List recent mentions for one memory entry.',
      'x-sdk-name': 'memory.listMentions',
      responses: {
        200: {
          description: '{ mentions: SerializedMemoryEntryMention[] }.',
          content: { 'application/json': { schema: resolver(ListMemoryEntryMentionsResponseSchema) } },
        },
        404: { description: 'Memory entry not found.' },
      },
    }),
    validator('param', MemoryEntryParamSchema),
    ...workspaceScoped,
    async (c) => {
      const { entryId } = c.req.valid('param')
      const entry = findEntryById(c.var.db, entryId)
      // Mirrors the soft-delete guard on the other single-entry routes.
      // Without `entry.deletedAt !== null`, mentions of a soft-deleted
      // entry remain readable during the 30-day retention window (cascade
      // only fires at hard-purge time).
      if (!entry || entry.workspaceId !== c.var.workspace!.id || entry.deletedAt !== null) {
        throw new NotFoundError('memory-entry', entryId)
      }
      const mentions = listRecentMentionsForEntry(c.var.db, entryId)
      return c.json({ mentions: mentions.map(serializeMention) })
    },
  )

// The USER-scoped `memory` HTTP surface — mounted at `/memory` (NO workspace
// prefix) from `apps/local-api/src/app.ts`, alongside the workspace-scoped
// twin (`/workspaces/:workspaceId/memory`). This one is the GLOBAL surface's
// anchor: ONLY the entries anchored to no workspace at all. A global memory
// belongs to the PERSON — `workspaceId` is null on the row.
//
//   GET  /entries           -> listGlobalMemoryEntriesForUser
//   POST /entries           -> createMemoryEntry (workspaceId: null)
//   POST /entries/from-file -> importMemoryEntryFromFile (workspaceId: null)
//   GET  /tags              -> listMemoryTags({ userId })
//
// No x-mcp on any of them: a session always runs in a workspace and reaches
// its entries through the workspace-scoped twins. These exist for the global
// memory panel, which has no workspace to anchor on.
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` →
// handler on `factory.createApp()`.

import { resolver, validator } from 'hono-openapi/zod'
import {
  createMemoryEntry,
  importMemoryEntryFromFile,
  listGlobalMemoryEntriesForUser,
  listMemoryTags,
  listMemoryTagsForEntries,
} from '@vynel/memory'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  CreateMemoryEntryBodySchema,
  ImportMemoryFileBodySchema,
  ListMemoryEntriesQuerySchema,
  ListMemoryEntriesResponseSchema,
  ListMemoryTagsResponseSchema,
  MemoryEntrySchema,
} from './schemas.js'
import { serializeEntry } from './serializers.js'

export const memoryUserApp = factory
  .createApp()
  // GET /entries — the user's global entries (the global panel's read).
  .get(
    '/entries',
    describeRoute({
      tags: ['memory'],
      summary: "List the user's GLOBAL memory entries (no workspace anchor).",
      'x-sdk-name': 'memoryUser.list',
      responses: {
        200: {
          description: '{ entries: SerializedMemoryEntry[], nextCursor }.',
          content: { 'application/json': { schema: resolver(ListMemoryEntriesResponseSchema) } },
        },
      },
    }),
    validator('query', ListMemoryEntriesQuerySchema),
    ...userScoped,
    (c) => {
      const q = c.req.valid('query')
      const input: Parameters<typeof listGlobalMemoryEntriesForUser>[1] = {
        userId: c.var.user.id,
        cursor:
          q.cursorId !== undefined
            ? { lastMentionedAt: q.cursorLastMentionedAt ?? null, id: q.cursorId }
            : null,
      }
      if (q.kind !== undefined) input.kind = q.kind
      if (q.includeArchived !== undefined) input.includeArchived = q.includeArchived
      if (q.limit !== undefined) input.limit = q.limit
      const { entries, nextCursor } = listGlobalMemoryEntriesForUser(c.var.db, input)
      const tagsByEntry = listMemoryTagsForEntries(
        c.var.db,
        entries.map((entry) => entry.id),
      )
      return c.json({
        entries: entries.map((entry) => serializeEntry(entry, tagsByEntry.get(entry.id) ?? [])),
        nextCursor,
      })
    },
  )
  // POST /entries — a global memory written by hand (workspaceId stays null).
  .post(
    '/entries',
    describeRoute({
      tags: ['memory'],
      summary: 'Create a GLOBAL memory entry (no workspace anchor).',
      'x-sdk-name': 'memoryUser.create',
      responses: {
        201: {
          description: 'SerializedMemoryEntry.',
          content: { 'application/json': { schema: resolver(MemoryEntrySchema) } },
        },
        400: { description: 'Validation error.' },
      },
    }),
    validator('json', CreateMemoryEntryBodySchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const input: Parameters<typeof createMemoryEntry>[1] = {
        userId: c.var.user.id,
        workspaceId: null,
        kind: body.kind,
        body: body.body,
        category: body.category,
        section: body.section,
        createdSource: 'user-manual',
      }
      if (body.title !== undefined) input.title = body.title
      if (body.tags !== undefined) input.tags = body.tags
      const entry = createMemoryEntry(c.var.db, input)
      return c.json(
        serializeEntry(entry, listMemoryTagsForEntries(c.var.db, [entry.id]).get(entry.id) ?? []),
        201,
      )
    },
  )
  // POST /entries/from-file — the same import, anchored at the user level.
  .post(
    '/entries/from-file',
    describeRoute({
      tags: ['memory'],
      summary: 'Import a single on-disk file as a GLOBAL memory entry.',
      'x-sdk-name': 'memoryUser.importFile',
      responses: {
        201: {
          description: 'SerializedMemoryEntry (imported).',
          content: { 'application/json': { schema: resolver(MemoryEntrySchema) } },
        },
        400: { description: 'Validation error (missing, unreadable, unsupported, or too long).' },
      },
    }),
    validator('json', ImportMemoryFileBodySchema),
    ...userScoped,
    async (c) => {
      const body = c.req.valid('json')
      const entry = await importMemoryEntryFromFile(c.var.db, {
        userId: c.var.user.id,
        workspaceId: null,
        absolutePath: body.absolutePath,
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
      })
      return c.json(
        serializeEntry(entry, listMemoryTagsForEntries(c.var.db, [entry.id]).get(entry.id) ?? []),
        201,
      )
    },
  )
  // GET /tags — the picker read over the user's OWN global entries.
  .get(
    '/tags',
    describeRoute({
      tags: ['memory'],
      summary: "List the user's global memory tags (in use + suggested defaults).",
      'x-sdk-name': 'memoryUser.listTags',
      responses: {
        200: {
          description: '{ tags: string[] } — "context" always leads.',
          content: { 'application/json': { schema: resolver(ListMemoryTagsResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => c.json({ tags: listMemoryTags(c.var.db, { userId: c.var.user.id }) }),
  )

// The USER-scoped `memory` HTTP surface — mounted at `/memory` (NO workspace
// prefix) from `apps/local-api/src/app.ts`, alongside the workspace-scoped
// twin (`/workspaces/:workspaceId/memory`). This one is the GLOBAL surface's
// anchor: ONLY the entries anchored to no workspace at all.
//
//   GET /entries -> listGlobalMemoryEntriesForUser
//
// No x-mcp: a session always runs in a workspace and reaches its entries
// through the workspace-scoped `list_memory_entries`; this route exists for
// the global memory panel, which has no workspace to anchor on.
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` →
// handler on `factory.createApp()`.

import { resolver, validator } from 'hono-openapi/zod'
import { listGlobalMemoryEntriesForUser, listMemoryTagsForEntries } from '@vynel/memory'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { ListMemoryEntriesQuerySchema, ListMemoryEntriesResponseSchema } from './schemas.js'
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

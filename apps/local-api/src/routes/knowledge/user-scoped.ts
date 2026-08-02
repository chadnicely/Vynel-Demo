// The USER-scoped `knowledge` HTTP surface — mounted at `/knowledge` (NO
// workspace prefix) from `apps/local-api/src/app.ts`, alongside the
// workspace-scoped twin (`/workspaces/:workspaceId/knowledge`). Where that
// twin FUSES scopes (a workspace's own sources + the user's global ones),
// this one is the GLOBAL surface's anchor: ONLY the user's global sources.
//
//   GET /sources -> listGlobalKnowledgeSourcesForUser
//
// No x-mcp: the agent already reaches global sources through the
// workspace-scoped `list_knowledge_sources` (which fuses both scopes), so
// exposing a second tool would add a duplicate with no new capability.
//
// Locked Hono protocol: describeRoute → `...userScoped` → handler on
// `factory.createApp()`.

import { resolver } from 'hono-openapi/zod'
import {
  listGlobalKnowledgeSourcesForUser,
  summarizeKnowledgeDocumentsBySource,
} from '@vynel/knowledge'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { ListKnowledgeSourcesResponseSchema } from './schemas.js'
import { serializeSourceListItem } from './serializers.js'

export const knowledgeUserApp = factory
  .createApp()
  // GET /sources — the user's global sources only (the global menu's read).
  .get(
    '/sources',
    describeRoute({
      tags: ['knowledge'],
      summary: "List the user's GLOBAL knowledge sources (no workspace anchor).",
      'x-sdk-name': 'knowledgeUser.listSources',
      responses: {
        200: {
          description: '{ sources: SerializedKnowledgeSourceListItem[] }.',
          content: { 'application/json': { schema: resolver(ListKnowledgeSourcesResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const sources = listGlobalKnowledgeSourcesForUser(c.var.db, c.var.user.id)
      const summaries = summarizeKnowledgeDocumentsBySource(
        c.var.db,
        sources.map((source) => source.id),
      )
      return c.json({
        sources: sources.map((source) => serializeSourceListItem(source, summaries.get(source.id))),
      })
    },
  )

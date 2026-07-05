// GET /activity + GET /activity/file — read the file_activities feed
// (workspace-scoped + per-path).
// Split from index.ts per Gate-3 C2 (structure-standard.md file-size cap).

import { resolver, validator } from 'hono-openapi/zod'
import { listFileHistory, listRecentActivity } from '@vynel/files'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  ListFileActivityResponseSchema,
  ListFileHistoryQuerySchema,
  ListRecentActivityQuerySchema,
} from './schemas.js'
import { serializeFileActivity } from './serializers.js'

export const activityRoutes = factory
  .createApp()
  .get(
    '/activity',
    describeRoute({
      tags: ['files'],
      summary: 'List recent file activity for the active workspace.',
      'x-sdk-name': 'files.listActivity',
      responses: {
        200: {
          description: '{ activities: SerializedFileActivity[], nextCursor }.',
          content: { 'application/json': { schema: resolver(ListFileActivityResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('query', ListRecentActivityQuerySchema),
    ...workspaceScoped,
    async (c) => {
      const q = c.req.valid('query')
      const input: Parameters<typeof listRecentActivity>[1] = {
        workspaceId: c.var.workspace!.id,
      }
      if (q.limit !== undefined) input.limit = q.limit
      if (q.cursorId !== undefined && q.cursorOccurredAt !== undefined) {
        input.cursor = { id: q.cursorId, occurredAt: q.cursorOccurredAt }
      }
      const { activities, nextCursor } = listRecentActivity(c.var.db, input)
      return c.json({ activities: activities.map(serializeFileActivity), nextCursor })
    },
  )
  .get(
    '/activity/file',
    describeRoute({
      tags: ['files'],
      summary: 'List activity for a single file (per-path history).',
      'x-sdk-name': 'files.listFileHistory',
      responses: {
        200: {
          description: '{ activities: SerializedFileActivity[], nextCursor }.',
          content: { 'application/json': { schema: resolver(ListFileActivityResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('query', ListFileHistoryQuerySchema),
    ...workspaceScoped,
    async (c) => {
      const q = c.req.valid('query')
      const input: Parameters<typeof listFileHistory>[1] = {
        workspaceId: c.var.workspace!.id,
        relativePath: q.path,
      }
      if (q.limit !== undefined) input.limit = q.limit
      if (q.cursorId !== undefined && q.cursorOccurredAt !== undefined) {
        input.cursor = { id: q.cursorId, occurredAt: q.cursorOccurredAt }
      }
      const { activities, nextCursor } = listFileHistory(c.var.db, input)
      return c.json({ activities: activities.map(serializeFileActivity), nextCursor })
    },
  )

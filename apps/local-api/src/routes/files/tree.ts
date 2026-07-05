// GET /tree — list one level of the workspace folder tree.
// Split from index.ts to keep each route file under the 300-line cap
// (Gate-3 C2; structure-standard.md "Universal rules / File size cap").

import { resolver, validator } from 'hono-openapi/zod'
import { listDirectory } from '@vynel/files'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { ListTreeQuerySchema, ListTreeResponseSchema } from './schemas.js'
import { serializeDirectoryEntry } from './serializers.js'

export const treeRoutes = factory.createApp().get(
  '/tree',
  describeRoute({
    tags: ['files'],
    summary: 'List one level of the workspace folder tree.',
    'x-sdk-name': 'files.tree',
    responses: {
      200: {
        description: '{ entries: SerializedDirectoryEntry[] }.',
        content: { 'application/json': { schema: resolver(ListTreeResponseSchema) } },
      },
      400: { description: 'Invalid path (traversal / NUL byte / absolute).' },
      404: { description: 'Directory or workspace not found.' },
    },
  }),
  validator('query', ListTreeQuerySchema),
  ...workspaceScoped,
  async (c) => {
    const q = c.req.valid('query')
    const entries = await listDirectory({
      workspacePath: c.var.workspace!.path,
      relativePath: q.path ?? '',
      includeHidden: q.includeHidden,
    })
    return c.json({ entries: entries.map(serializeDirectoryEntry) })
  },
)

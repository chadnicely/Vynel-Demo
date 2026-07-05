// GET /content + PUT /content — read for preview/edit; save edited text.
// Split from index.ts per Gate-3 C2 (structure-standard.md file-size cap).

import { resolver, validator } from 'hono-openapi/zod'
import { readFileContent, writeFileContent } from '@vynel/files'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  FileContentSchema,
  FileMetadataSchema,
  ReadFileQuerySchema,
  WriteFileBodySchema,
} from './schemas.js'
import { serializeFileContent, serializeFileMetadata } from './serializers.js'

export const contentRoutes = factory
  .createApp()
  .get(
    '/content',
    describeRoute({
      tags: ['files'],
      summary: 'Read a file for preview or edit.',
      'x-sdk-name': 'files.readContent',
      responses: {
        200: {
          description: 'SerializedFileContent.',
          content: { 'application/json': { schema: resolver(FileContentSchema) } },
        },
        400: { description: 'Invalid path.' },
        404: { description: 'File or workspace not found.' },
      },
    }),
    validator('query', ReadFileQuerySchema),
    ...workspaceScoped,
    async (c) => {
      const q = c.req.valid('query')
      const content = await readFileContent({
        workspacePath: c.var.workspace!.path,
        relativePath: q.path,
      })
      return c.json(serializeFileContent(content))
    },
  )
  .put(
    '/content',
    describeRoute({
      tags: ['files'],
      summary: 'Save the contents of a text file (editor=self).',
      'x-sdk-name': 'files.saveContent',
      responses: {
        200: {
          description: 'SerializedFileMetadata.',
          content: { 'application/json': { schema: resolver(FileMetadataSchema) } },
        },
        400: { description: 'Invalid path / too large / .vynel guard.' },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('json', WriteFileBodySchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const result = await writeFileContent(
        c.var.db,
        {
          workspaceId: c.var.workspace!.id,
          userId: c.var.user.id,
          workspacePath: c.var.workspace!.path,
          relativePath: body.path,
          content: body.content,
        },
        { logger: c.var.logger },
      )
      return c.json(serializeFileMetadata(result))
    },
  )

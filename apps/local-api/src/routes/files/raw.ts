// GET /raw — stream raw bytes (images / pdf / download).
// Split from index.ts per Gate-3 C2 (structure-standard.md file-size cap).
//
// Unbounded streaming per gate-resolved default (single-user-local
// Phase 1; no realistic abuse vector). Buffer-based read — a future
// profile can swap to createReadStream + stream(c, ...) if needed.

import { readFile } from 'node:fs/promises'
import { validator } from 'hono-openapi/zod'
import { streamFileBytes } from '@vynel/files'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { StreamRawQuerySchema } from './schemas.js'

export const rawRoutes = factory.createApp().get(
  '/raw',
  describeRoute({
    tags: ['files'],
    summary: 'Stream a file as raw bytes (for images, PDF, download).',
    'x-sdk-name': 'files.raw',
    responses: {
      200: { description: 'Raw file bytes; content-type per file extension.' },
      400: { description: 'Invalid path.' },
      404: { description: 'File or workspace not found.' },
    },
  }),
  validator('query', StreamRawQuerySchema),
  ...workspaceScoped,
  async (c) => {
    const q = c.req.valid('query')
    const meta = await streamFileBytes({
      workspacePath: c.var.workspace!.path,
      relativePath: q.path,
    })
    const buffer = await readFile(meta.absolutePath)
    c.header('Content-Type', meta.contentType)
    c.header('Content-Length', String(meta.fileSizeBytes))
    return c.body(buffer)
  },
)

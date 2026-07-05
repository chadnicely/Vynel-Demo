// POST /file, /directory, /move, /delete — user-manager mutations.
// Each writes an editor='self' file_activities row via its core op.
// Split from index.ts per Gate-3 C2 (structure-standard.md file-size cap).

import { resolver, validator } from 'hono-openapi/zod'
import { createDirectory, createFile, deleteEntry, moveEntry } from '@vynel/files'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  CreateDirectoryBodySchema,
  CreateDirectoryResponseSchema,
  CreateFileBodySchema,
  DeleteBodySchema,
  DeleteResponseSchema,
  FileMetadataSchema,
  MoveBodySchema,
  MoveResponseSchema,
} from './schemas.js'
import { serializeFileMetadata } from './serializers.js'

export const mutationRoutes = factory
  .createApp()
  .post(
    '/file',
    describeRoute({
      tags: ['files'],
      summary: 'Create a new file (editor=self). Refuses if it already exists.',
      'x-sdk-name': 'files.createFile',
      responses: {
        200: {
          description: 'SerializedFileMetadata.',
          content: { 'application/json': { schema: resolver(FileMetadataSchema) } },
        },
        400: { description: 'Invalid path / too large / .vynel guard.' },
        409: { description: 'A file already exists at that path.' },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('json', CreateFileBodySchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const result = await createFile(
        c.var.db,
        {
          workspaceId: c.var.workspace!.id,
          userId: c.var.user.id,
          workspacePath: c.var.workspace!.path,
          relativePath: body.path,
          ...(body.content !== undefined ? { content: body.content } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeFileMetadata(result))
    },
  )
  .post(
    '/directory',
    describeRoute({
      tags: ['files'],
      summary: 'Create a new folder (idempotent; editor=self).',
      'x-sdk-name': 'files.createDirectory',
      responses: {
        200: {
          description: '{ relativePath, wasCreated }.',
          content: { 'application/json': { schema: resolver(CreateDirectoryResponseSchema) } },
        },
        400: { description: 'Invalid path / .vynel guard.' },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('json', CreateDirectoryBodySchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const result = await createDirectory(
        c.var.db,
        {
          workspaceId: c.var.workspace!.id,
          userId: c.var.user.id,
          workspacePath: c.var.workspace!.path,
          relativePath: body.path,
        },
        { logger: c.var.logger },
      )
      return c.json(result)
    },
  )
  .post(
    '/move',
    describeRoute({
      tags: ['files'],
      summary: 'Rename or move a file/folder (editor=self).',
      'x-sdk-name': 'files.move',
      responses: {
        200: {
          description: '{ fromPath, toPath }.',
          content: { 'application/json': { schema: resolver(MoveResponseSchema) } },
        },
        400: { description: 'Invalid path / .vynel guard.' },
        409: { description: 'Target already exists; pass overwrite=true to replace.' },
        404: { description: 'Source not found.' },
      },
    }),
    validator('json', MoveBodySchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const result = await moveEntry(
        c.var.db,
        {
          workspaceId: c.var.workspace!.id,
          userId: c.var.user.id,
          workspacePath: c.var.workspace!.path,
          fromPath: body.fromPath,
          toPath: body.toPath,
          ...(body.overwrite !== undefined ? { overwrite: body.overwrite } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(result)
    },
  )
  .post(
    '/delete',
    describeRoute({
      tags: ['files'],
      summary:
        'Hard-delete a file or folder (editor=self). Non-empty dirs require recursive=true.',
      'x-sdk-name': 'files.delete',
      responses: {
        200: {
          description: '{ relativePath, kind }.',
          content: { 'application/json': { schema: resolver(DeleteResponseSchema) } },
        },
        400: { description: 'Invalid path / .vynel guard.' },
        409: { description: 'Target is a non-empty directory; pass recursive=true.' },
        404: { description: 'Target not found.' },
      },
    }),
    validator('json', DeleteBodySchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const result = await deleteEntry(
        c.var.db,
        {
          workspaceId: c.var.workspace!.id,
          userId: c.var.user.id,
          workspacePath: c.var.workspace!.path,
          relativePath: body.path,
          ...(body.recursive !== undefined ? { recursive: body.recursive } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(result)
    },
  )

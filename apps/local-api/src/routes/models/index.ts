// The `/models` HTTP surface — USER-scoped, mounted at `/models` from
// `apps/local-api/src/app.ts`: the local models on this computer, as the
// Settings → Embedding / Voice screens read and drive them.
//
//   GET    /                    -> every catalog model with its state (+ download progress)
//   POST   /:modelId/download   -> start fetching one (returns the current list entry)
//   POST   /:modelId/cancel     -> abort a running fetch
//   DELETE /:modelId            -> remove the model's files
//
// NO x-mcp anywhere — which models are on the disk is the USER's door, never
// an agent tool (the `server-install` stance). Progress is read by polling
// GET / while a download runs (the row IS the progress surface).
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses.

import { resolver, validator } from 'hono-openapi/zod'
import type { Context } from 'hono'
import { ConflictError } from '@vynel/errors'
import {
  cancelLocalModelDownload,
  describeLocalModel,
  getLocalModelEntryOrThrow,
  listLocalModelStatuses,
  removeLocalModel,
  startLocalModelDownload,
  type LocalModelsDeps,
} from '@vynel/models'
import type { LocalModelStatusResponse } from '@vynel/contracts/models/local-models-http'
import type { AppEnv } from '../../factory.js'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  CancelDownloadResponseSchema,
  LocalModelParamSchema,
  LocalModelStatusResponseSchema,
  LocalModelsResponseSchema,
} from './schemas.js'

// Same closed-taxonomy rationale as server-install's requireMasterKey: 409 is
// the closest fit for "this engine can't take the request right now".
function requireLocalModels(c: Context<AppEnv>): LocalModelsDeps {
  const deps = c.var.localModels
  if (deps === null) {
    throw new ConflictError(
      'Local models are not managed by this engine — a remote engine keeps its own models.',
    )
  }
  return deps
}

function describeOne(deps: LocalModelsDeps, modelId: string): Promise<LocalModelStatusResponse> {
  return describeLocalModel(deps, getLocalModelEntryOrThrow(deps, modelId))
}

export const modelsApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['models'],
      summary: 'List the local models on this computer with their state.',
      'x-sdk-name': 'localModels.list',
      responses: {
        200: {
          description: 'Every catalog model: installed / missing / downloading (+ bytes) / failed.',
          content: { 'application/json': { schema: resolver(LocalModelsResponseSchema) } },
        },
        409: { description: 'This engine does not manage local models.' },
      },
    }),
    ...userScoped,
    async (c) => {
      const models = await listLocalModelStatuses(requireLocalModels(c))
      return c.json({ models })
    },
  )
  .post(
    '/:modelId/download',
    describeRoute({
      tags: ['models'],
      summary: 'Download one local model (runs in the background).',
      'x-sdk-name': 'localModels.download',
      responses: {
        200: {
          description: 'The model, now downloading — poll GET /models to follow the bytes.',
          content: { 'application/json': { schema: resolver(LocalModelStatusResponseSchema) } },
        },
        404: { description: 'Unknown model.' },
        409: { description: 'Already downloading, or this engine does not manage local models.' },
      },
    }),
    validator('param', LocalModelParamSchema),
    ...userScoped,
    async (c) => {
      const deps = requireLocalModels(c)
      const { modelId } = c.req.valid('param')
      startLocalModelDownload(deps, modelId)
      return c.json(await describeOne(deps, modelId))
    },
  )
  .post(
    '/:modelId/cancel',
    describeRoute({
      tags: ['models'],
      summary: 'Cancel a running model download.',
      'x-sdk-name': 'localModels.cancelDownload',
      responses: {
        200: {
          description: 'Whether there was a download to cancel.',
          content: { 'application/json': { schema: resolver(CancelDownloadResponseSchema) } },
        },
        404: { description: 'Unknown model.' },
      },
    }),
    validator('param', LocalModelParamSchema),
    ...userScoped,
    (c) => {
      const cancelled = cancelLocalModelDownload(requireLocalModels(c), c.req.valid('param').modelId)
      return c.json({ cancelled })
    },
  )
  .delete(
    '/:modelId',
    describeRoute({
      tags: ['models'],
      summary: "Remove a local model's files from this computer.",
      'x-sdk-name': 'localModels.remove',
      responses: {
        200: {
          description: 'The model, now missing.',
          content: { 'application/json': { schema: resolver(LocalModelStatusResponseSchema) } },
        },
        404: { description: 'Unknown model.' },
        409: { description: 'Downloading right now — cancel first.' },
      },
    }),
    validator('param', LocalModelParamSchema),
    ...userScoped,
    async (c) => {
      const deps = requireLocalModels(c)
      const { modelId } = c.req.valid('param')
      await removeLocalModel(deps, modelId)
      return c.json(await describeOne(deps, modelId))
    },
  )

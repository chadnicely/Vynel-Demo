// Zod schemas for the `/models` routes (api-internal — one consumer). The
// response shapes mirror `@vynel/contracts/models/local-models-http`; declared
// here so `describeRoute` can attach a real OpenAPI body via `resolver()`.

import { z } from 'zod'

export const LocalModelParamSchema = z.object({
  modelId: z.string().min(1).max(64),
})

const LocalModelSpeakerSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  accent: z.enum(['American', 'British']),
  gender: z.enum(['female', 'male']),
})

const LocalModelDownloadSchema = z.object({
  bytes: z.number(),
  total: z.number().nullable(),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
})

export const LocalModelStatusResponseSchema = z.object({
  id: z.string(),
  kind: z.enum(['embedding', 'tts', 'stt', 'vad']),
  label: z.string(),
  description: z.string(),
  approxBytes: z.number(),
  speakers: z.array(LocalModelSpeakerSchema).nullable(),
  state: z.enum(['installed', 'missing', 'downloading', 'failed']),
  installedAt: z.string().nullable(),
  download: LocalModelDownloadSchema.nullable(),
})

export const LocalModelsResponseSchema = z.object({
  models: z.array(LocalModelStatusResponseSchema),
})

export const CancelDownloadResponseSchema = z.object({
  cancelled: z.boolean(),
})

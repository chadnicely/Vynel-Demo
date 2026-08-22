// Zod request/response schemas for the `users` routes (api-internal — only
// one consumer). Ported faithfully from the source `apps/api/src/routes/
// users/schemas.ts`.

import { z } from 'zod'
import { LOCAL_STT_MODEL_IDS, LOCAL_TTS_MODEL_IDS } from '@vynel/contracts/models/local-model-catalog'

export const UpdateUserProfileRequestSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  emailAddress: z.string().email().nullable().optional(),
  locale: z.string().min(2).max(20).optional(),
  timezone: z.string().min(1).max(120).optional(),
})

export const SetUserPreferencesRequestSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  defaultWorkspaceId: z.string().optional(),
  chatStreamingEnabled: z.boolean().optional(),
  reducedMotion: z.boolean().optional(),
  voiceTtsModelId: z.enum(LOCAL_TTS_MODEL_IDS).optional(),
  voiceSpeakerId: z.number().int().min(0).optional(),
  voiceSttModelId: z.enum(LOCAL_STT_MODEL_IDS).optional(),
  desktopActionsEnabled: z.boolean().optional(),
})

export const UserResponseSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  emailAddress: z.string().nullable(),
  locale: z.string(),
  timezone: z.string(),
  hasCompletedOnboarding: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const UserPreferencesResponseSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  defaultWorkspaceId: z.string().nullable(),
  chatStreamingEnabled: z.boolean(),
  reducedMotion: z.boolean(),
  voiceTtsModelId: z.enum(LOCAL_TTS_MODEL_IDS),
  voiceSpeakerId: z.number().int(),
  voiceSttModelId: z.enum(LOCAL_STT_MODEL_IDS),
  desktopActionsEnabled: z.boolean(),
})

export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileRequestSchema>
export type SetUserPreferencesRequest = z.infer<typeof SetUserPreferencesRequestSchema>
export type UserResponse = z.infer<typeof UserResponseSchema>
export type UserPreferencesResponse = z.infer<typeof UserPreferencesResponseSchema>

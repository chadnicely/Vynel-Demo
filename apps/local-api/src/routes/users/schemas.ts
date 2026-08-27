// Zod request/response schemas for the `users` routes (api-internal — only
// one consumer). Ported faithfully from the source `apps/api/src/routes/
// users/schemas.ts`.

import { z } from 'zod'
import { LOCAL_STT_MODEL_IDS, LOCAL_TTS_MODEL_IDS } from '@vynel/contracts/models/local-model-catalog'
import { VOICE_STT_SOURCES, VOICE_TTS_SOURCES } from '@vynel/contracts/voice/voice-providers'
import {
  VOICE_TIER_ALLOWED_MODELS,
  VOICE_TIER_THINKING_OPTIONS,
} from '@vynel/contracts/chat/voice-tier'

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
  voiceTtsSource: z.enum(VOICE_TTS_SOURCES).optional(),
  voiceTtsProviderVoiceId: z.string().min(1).max(200).nullable().optional(),
  voiceSttSource: z.enum(VOICE_STT_SOURCES).optional(),
  desktopActionsEnabled: z.boolean().optional(),
  voiceTierModel: z.enum(VOICE_TIER_ALLOWED_MODELS).optional(),
  voiceTierThinking: z.enum(VOICE_TIER_THINKING_OPTIONS).optional(),
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
  voiceTtsSource: z.enum(VOICE_TTS_SOURCES),
  voiceTtsProviderVoiceId: z.string().nullable(),
  voiceSttSource: z.enum(VOICE_STT_SOURCES),
  desktopActionsEnabled: z.boolean(),
  voiceTierModel: z.enum(VOICE_TIER_ALLOWED_MODELS),
  voiceTierThinking: z.enum(VOICE_TIER_THINKING_OPTIONS),
})

export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileRequestSchema>
export type SetUserPreferencesRequest = z.infer<typeof SetUserPreferencesRequestSchema>
export type UserResponse = z.infer<typeof UserResponseSchema>
export type UserPreferencesResponse = z.infer<typeof UserPreferencesResponseSchema>

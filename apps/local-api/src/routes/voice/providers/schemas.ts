// Zod request/response schemas for the `/voice/providers` + cloud-audio
// routes (api-internal — only one consumer).

import { z } from 'zod'
import { VOICE_PROVIDER_IDS } from '@vynel/contracts/voice/voice-providers'

export const VoiceProviderParamSchema = z.object({
  provider: z.enum(VOICE_PROVIDER_IDS),
})

export const ConnectVoiceProviderRequestSchema = z.object({
  apiKey: z.string().min(1).max(500),
})

// The catalog entry + this user's connection state — NEVER the key.
export const VoiceProviderStatusSchema = z.object({
  id: z.enum(VOICE_PROVIDER_IDS),
  label: z.string(),
  tagline: z.string(),
  connectHint: z.string(),
  credentialField: z.object({
    key: z.literal('apiKey'),
    label: z.string(),
    placeholder: z.string(),
  }),
  supports: z.object({ tts: z.boolean(), stt: z.boolean() }),
  connected: z.boolean(),
  accountLabel: z.string().nullable(),
  connectedAt: z.string().nullable(),
})

export const ListVoiceProvidersResponseSchema = z.array(VoiceProviderStatusSchema)

export const VoiceProviderVoicesResponseSchema = z.object({
  voices: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      language: z.string().nullable(),
    }),
  ),
})

export const TranscribeResponseSchema = z.object({
  text: z.string(),
})

export const ProviderSynthesizeRequestSchema = z.object({
  text: z.string().min(1).max(5_000),
})

export type VoiceProviderStatus = z.infer<typeof VoiceProviderStatusSchema>

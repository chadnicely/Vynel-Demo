// Zod schemas for the `providers` routes (api-internal — one consumer;
// promote to `@vynel/contracts` only on the second). Ported faithfully from
// the source `apps/api/src/routes/providers/schemas.ts`; the two bare-array
// envelopes are declared so `describeRoute` resolves real OpenAPI shapes
// (house rule: every JSON 200 declares its schema — zero runtime change).

import { z } from 'zod'

export const AiAgentProviderIdSchema = z.enum(['claude', 'codex', 'gemini', 'cursor'])

export const AuthenticationMethodSchema = z.enum(['oauth', 'api-key'])

export const SkillScopeSchema = z.enum(['user', 'workspace', 'plugin'])

export const ProviderIdParamSchema = z.object({
  providerId: AiAgentProviderIdSchema,
})

export const DiscoverSkillsQuerySchema = z.object({
  workspacePath: z.string().optional(),
})

export const AuthenticationStatusResponseSchema = z.object({
  providerId: AiAgentProviderIdSchema,
  isInstalled: z.boolean(),
  isAuthenticated: z.boolean(),
  authenticatedAccountLabel: z.string().nullable(),
  authenticationMethod: AuthenticationMethodSchema.nullable(),
  inactiveReason: z.string().nullable(),
})

export const InstalledSkillResponseSchema = z.object({
  providerId: AiAgentProviderIdSchema,
  scope: SkillScopeSchema,
  skillName: z.string(),
  displayDescription: z.string().nullable(),
  installLocation: z.string(),
  invocationSyntax: z.string(),
})

// Bare-array envelopes — the source routes return arrays directly, and bare
// arrays stay bare arrays.
export const ListProvidersWithStatusResponseSchema = z.array(AuthenticationStatusResponseSchema)

export const DiscoverInstalledSkillsResponseSchema = z.array(InstalledSkillResponseSchema)

// The model roster (`GET /:providerId/models`) — mirrors the contracts'
// `AvailableChatModel` (discovered fields + read-time-derived context window).
export const AvailableChatModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  supportedEffortLevels: z.array(z.enum(['low', 'medium', 'high', 'xhigh', 'max'])).nullable(),
  contextWindowTokens: z.number(),
})

export const ListAvailableModelsResponseSchema = z.object({
  models: z.array(AvailableChatModelSchema),
  /** False while the picker is still on the static floor (engine never asked). */
  isDiscovered: z.boolean(),
})

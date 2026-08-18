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
  /** Identity metadata from the CLI's own status report — display data, never
   *  a credential (D14). Null when the CLI doesn't say. */
  email: z.string().nullable(),
  organizationName: z.string().nullable(),
  subscriptionPlan: z.string().nullable(),
})

// The local sign-in flow (top-bar account popup): the relay spawns
// `claude auth login`, hands the browser URL out, takes the pasted code back.
export const LoginSessionParamSchema = z.object({
  providerId: AiAgentProviderIdSchema,
  loginId: z.string().min(1),
})

export const BeginLoginResponseSchema = z.object({
  loginId: z.string(),
  /** The page the user opens (in their browser) to authorize this machine. */
  authorizationUrl: z.string(),
})

export const SubmitLoginCodeRequestSchema = z.object({
  code: z.string().min(1, 'Paste the code from your browser first.'),
})

export const CancelLoginResponseSchema = z.object({
  ok: z.literal(true),
})

// The account's limit windows (the popup's Limits tab) — the engine's own
// readings, captured from the session stream per interactive turn.
export const RateLimitSnapshotResponseSchema = z.object({
  /** The provider's window vocabulary ('five_hour', 'seven_day', …). */
  windowKind: z.string(),
  status: z.enum(['allowed', 'allowed_warning', 'rejected']),
  /** Percent of the window used (0–100); null when the engine didn't say. */
  utilization: z.number().nullable(),
  resetsAt: z.string().nullable(),
  capturedAt: z.string(),
})

export const ListRateLimitSnapshotsResponseSchema = z.object({
  limits: z.array(RateLimitSnapshotResponseSchema),
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

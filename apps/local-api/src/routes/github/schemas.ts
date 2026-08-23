// Zod schemas for the `github` routes (api-internal — one consumer).

import { z } from 'zod'

export const GitHubConnectionStatusResponseSchema = z.object({
  isInstalled: z.boolean(),
  isAuthenticated: z.boolean(),
  /** The signed-in handle — "chadnicely" — or null. */
  accountLabel: z.string().nullable(),
  /** Why it is not usable — "not installed", "Not signed in" — or null. */
  inactiveReason: z.string().nullable(),
})

export const GitHubSignInStateResponseSchema = z.object({
  loginId: z.string(),
  phase: z.enum(['awaiting-browser', 'signed-in', 'failed']),
  /** The one-time code the person types at the device URL. */
  userCode: z.string().nullable(),
  verificationUrl: z.string().nullable(),
  errorMessage: z.string().nullable(),
})

export const SignInIdParamSchema = z.object({
  loginId: z.string().min(1),
})

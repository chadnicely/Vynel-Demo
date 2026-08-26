// Per-step input schemas — the ONE place a step's wire shape is declared. The
// dispatcher parses with these, the api route's Zod body schema derives from
// them, and the web submits the inferred types.

import { z } from 'zod'

export const WelcomeStepInputSchema = z.object({
  acknowledged: z.literal(true),
})

export const ProfileStepInputSchema = z.object({
  displayName: z.string().min(1).max(160), // → users.displayName (the only name column)
  locale: z.string().min(2).max(20), // BCP-47, e.g. 'en-US' → users.locale
  timezone: z.string().min(1).max(60), // IANA, e.g. 'America/Los_Angeles' → users.timezone
})

export const IdentitySeedStepInputSchema = z.object({
  aboutYouParagraph: z.string().min(1).max(2000),
  workspaceContextAnswer: z.string().min(1).max(2000),
  workingStyleAnswer: z.string().max(2000).optional(),
})

// Claude is the only brain that builds today. The literal union is what
// refuses Codex / Kimi — the step shows them as "Not yet", and a client can
// never half-connect one.
export const ConnectBrainStepInputSchema = z.object({
  providerId: z.literal('claude'),
})

// Skipping is a real answer, not a failure.
export const GitHubBackupStepInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skipped') }),
  z.object({ kind: z.literal('connected') }),
])

export type WelcomeStepInput = z.infer<typeof WelcomeStepInputSchema>
export type ProfileStepInput = z.infer<typeof ProfileStepInputSchema>
export type IdentitySeedStepInput = z.infer<typeof IdentitySeedStepInputSchema>
export type ConnectBrainStepInput = z.infer<typeof ConnectBrainStepInputSchema>
export type GitHubBackupStepInput = z.infer<typeof GitHubBackupStepInputSchema>

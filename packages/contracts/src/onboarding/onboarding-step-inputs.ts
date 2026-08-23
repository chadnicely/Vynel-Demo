// Per-step Zod input schemas for the onboarding wizard — shared by the api
// route validators + the apps/web wizard. `XxxSchema` suffix; the inferred
// type drops it. `@vynel/contracts` owns zod (no @vynel/db dependency).

import { z } from 'zod'

export const WelcomeStepInputSchema = z.object({
  acknowledged: z.literal(true),
})

export const ProfileStepInputSchema = z.object({
  displayName: z.string().min(1).max(160), // → users.displayName (the only name column)
  locale: z.string().min(2).max(20), // BCP-47, e.g. 'en-US' → users.locale
  timezone: z.string().min(1).max(60), // IANA, e.g. 'America/Los_Angeles' → users.timezone
})

export type WelcomeStepInput = z.infer<typeof WelcomeStepInputSchema>
export type ProfileStepInput = z.infer<typeof ProfileStepInputSchema>

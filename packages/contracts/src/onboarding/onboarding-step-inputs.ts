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

export const NameWorkspaceStepInputSchema = z.object({
  name: z.string().min(1).max(120),
})

export const IdentitySeedStepInputSchema = z.object({
  aboutYouParagraph: z.string().min(1).max(2000),
  workspaceContextAnswer: z.string().min(1).max(2000),
  workingStyleAnswer: z.string().max(2000).optional(),
})

export const InstallSuggestedSkillsStepInputSchema = z.object({
  skillIdsToInstall: z.array(z.string()).max(20), // Verified skill ids; empty allowed
  skillSettingsBySkillId: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})

export const OptionalChannelStepInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skipped') }),
  z.object({
    kind: z.literal('connect'),
    channelKind: z.literal('telegram'), // Phase 1: Telegram only (channels D15)
    displayName: z.string().min(1).max(120),
    botCredentials: z.object({ botToken: z.string().min(1) }), // matches channels' BotCredentials
    initialAllowedSenderId: z.string().optional(),
  }),
])

export const OptionalScheduleStepInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skipped') }),
  z.object({
    kind: z.literal('create-morning-briefing'),
    timezone: z.string().min(1).max(60).optional(), // defaults to profile.timezone
    fireHour: z.number().int().min(0).max(23),
    channelId: z.string().optional(), // absent ⇒ chat-only
  }),
])

export type WelcomeStepInput = z.infer<typeof WelcomeStepInputSchema>
export type ProfileStepInput = z.infer<typeof ProfileStepInputSchema>
export type NameWorkspaceStepInput = z.infer<typeof NameWorkspaceStepInputSchema>
export type IdentitySeedStepInput = z.infer<typeof IdentitySeedStepInputSchema>
export type InstallSuggestedSkillsStepInput = z.infer<typeof InstallSuggestedSkillsStepInputSchema>
export type OptionalChannelStepInput = z.infer<typeof OptionalChannelStepInputSchema>
export type OptionalScheduleStepInput = z.infer<typeof OptionalScheduleStepInputSchema>

// Zod schemas for the onboarding routes — the wire shapes hono-openapi
// publishes into the SDK. Step inputs come from the ONE contract home; the
// step-kind enum mirrors the contracts catalog (a kind the catalog does not
// know 400s at the boundary).

import { z } from 'zod'
import {
  WelcomeStepInputSchema,
  ProfileStepInputSchema,
  IdentitySeedStepInputSchema,
  ConnectBrainStepInputSchema,
  GitHubBackupStepInputSchema,
} from '@vynel/contracts/onboarding/onboarding-step-inputs'

export const RunIdParamSchema = z.object({
  runId: z.string().min(1),
})

const OnboardingStepKindSchema = z.enum([
  'welcome',
  'profile',
  'identity-seed',
  'connect-brain',
  'github-backup',
])

export const SubmitStepBodySchema = z.object({
  stepKind: OnboardingStepKindSchema,
  stepInput: z.unknown(),
})

const CollectedOnboardingDataSchema = z.object({
  welcome: WelcomeStepInputSchema.optional(),
  profile: ProfileStepInputSchema.optional(),
  identitySeed: IdentitySeedStepInputSchema.optional(),
  connectBrain: ConnectBrainStepInputSchema.optional(),
  githubBackup: GitHubBackupStepInputSchema.optional(),
})

export const OnboardingRunResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string().nullable(),
  currentStepKind: OnboardingStepKindSchema,
  completedSteps: z.array(OnboardingStepKindSchema),
  collectedData: z.record(z.string(), z.unknown()),
  status: z.enum(['in-progress', 'completed', 'abandoned']),
  startedAt: z.string(),
  lastActivityAt: z.string(),
  completedAt: z.string().nullable(),
})

export const NeedsOnboardingResponseSchema = z.object({
  needsOnboarding: z.boolean(),
  inProgressRunId: z.string().nullable(),
})

const OnboardingStepCatalogEntryResponseSchema = z.object({
  stepKind: OnboardingStepKindSchema,
  order: z.number(),
  isSkippable: z.boolean(),
  displayLabel: z.string(),
  oneLineDescription: z.string(),
})

export const OnboardingRunStatusSnapshotResponseSchema = z.object({
  run: OnboardingRunResponseSchema,
  currentStep: OnboardingStepCatalogEntryResponseSchema,
  totalSteps: z.number(),
  completedStepCount: z.number(),
  collectedData: CollectedOnboardingDataSchema,
})

// Zod schemas for the `onboarding` HTTP routes — request schemas ported
// faithfully from the source `apps/api/src/routes/onboarding/schemas.ts`;
// response schemas added per the repo-wide "every 200 declares a resolver()
// schema" rule (knowledge-routes precedent) — ZERO runtime change, these
// declare exactly what each handler already returns (`c.json(coreOp(...))`
// with no serializer — dates pass through `JSON.stringify`'s native
// Date→ISO conversion, the `root`-routes precedent for a raw-object return).

import { z } from 'zod'
import {
  WelcomeStepInputSchema,
  ProfileStepInputSchema,
  NameWorkspaceStepInputSchema,
  IdentitySeedStepInputSchema,
  InstallSuggestedSkillsStepInputSchema,
  OptionalChannelStepInputSchema,
  OptionalScheduleStepInputSchema,
} from '@vynel/contracts/onboarding/onboarding-step-inputs'

export const RunIdParamSchema = z.object({
  runId: z.string().min(1),
})

const OnboardingStepKindSchema = z.enum([
  'welcome',
  'profile',
  'name-workspace',
  'identity-seed',
  'install-suggested-skills',
  'optional-channel',
  'optional-schedule',
])

// `stepKind` is the OnboardingStepKind enum (kept in sync with the contract);
// `stepInput` is opaque here — the core dispatcher validates it per-step.
export const SubmitStepBodySchema = z.object({
  stepKind: OnboardingStepKindSchema,
  stepInput: z.unknown(),
})

// ── Response schemas ────────────────────────────────────────────────

// The wire shape of `CollectedOnboardingData` — each step's parsed input,
// keyed by step name (the `advance-run.ts` COLLECTED_KEY_BY_STEP mapping),
// reusing the exact per-step contract schemas (one source of truth per shape).
const CollectedOnboardingDataSchema = z.object({
  welcome: WelcomeStepInputSchema.optional(),
  profile: ProfileStepInputSchema.optional(),
  nameWorkspace: NameWorkspaceStepInputSchema.optional(),
  identitySeed: IdentitySeedStepInputSchema.optional(),
  installSuggestedSkills: InstallSuggestedSkillsStepInputSchema.optional(),
  optionalChannel: OptionalChannelStepInputSchema.optional(),
  optionalSchedule: OptionalScheduleStepInputSchema.optional(),
  workspacePath: z.string().optional(),
  channelId: z.string().optional(),
})

// The `onboarding_runs` row — `startedAt` / `lastActivityAt` / `completedAt`
// are Date columns at the core layer; over the wire (`JSON.stringify`) they
// serialize to ISO strings.
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
  suggestedSkills: z
    .object({
      defaultCheckedSkillIds: z.array(z.string()),
      optionalSkillIds: z.array(z.string()),
    })
    .optional(),
})

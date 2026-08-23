// `onboarding_runs` table for the `onboarding` domain — one row per
// onboarding attempt (the step state machine + the accumulated per-step
// input). `userId` is NOT NULL (the single local user exists from boot —
// decisions.md D14); `workspaceId` is null in the live two-step flow (only
// the retired name-workspace step ever set it). There is NO `deletedAt` — the lifecycle is the `status` enum
// (in-progress / completed / abandoned, decisions.md D11). `completedSteps`
// + `collectedData` are `json<T>()` (opaque, never filtered).
//
// Spec: `docs/blueprints/onboarding/blueprint.md §3.1`. Columns beyond the
// primary key are filled in by /build-domain (TDD).
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`.

import { table, id, text, json, timestamp, index } from '@vynel/db/dialect'
import { users } from '../users/users.js'
import { workspaces } from '../workspaces/workspaces.js'

// `OnboardingStepKind` + `OnboardingRunStatus` are declared LOCALLY (the
// schedules `ScheduleTemplateKind` colocation precedent) — schema files import
// `@vynel/db/dialect` + sibling schema only, never `@vynel/contracts`. The
// 7-literal union DELIBERATELY retains the five kinds retired 2026-08-24:
// rows carrying them exist, and this type describes STORED data — trimming it
// would make those rows type-lies. The live two-step flow is the contracts
// catalog's, and its string-widened `findOnboardingStepByKind` is the
// boundary where these legacy kinds are read.
export type OnboardingStepKind =
  | 'welcome'
  | 'profile'
  | 'name-workspace'
  | 'identity-seed'
  | 'install-suggested-skills'
  | 'optional-channel'
  | 'optional-schedule'

export type OnboardingRunStatus = 'in-progress' | 'completed' | 'abandoned'

export const onboardingRuns = table(
  'onboarding_runs',
  {
    id: id().primaryKey(),
    // NOT NULL — id() is not-null by design; the single user exists from boot
    // (decisions.md D14), stamped at startOnboardingRun.
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable until step 4 creates the workspace — `text()` (not `id()`, which
    // is not-null) so a `set null` FK is expressible.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'set null' }),
    currentStepKind: text().$type<OnboardingStepKind>().notNull(),
    completedSteps: json<OnboardingStepKind[]>().notNull(),
    // Opaque at the DB layer (the chat tool-I/O `json<unknown>` precedent); the
    // CORE narrows it to `@vynel/contracts` `CollectedOnboardingData`.
    collectedData: json<Record<string, unknown>>().notNull(),
    status: text().$type<OnboardingRunStatus>().notNull(),
    startedAt: timestamp().notNull(),
    lastActivityAt: timestamp().notNull(),
    completedAt: timestamp(),
  },
  (t) => ({
    userIdx: index('idx_onboarding_runs_user').on(t.userId),
    statusIdx: index('idx_onboarding_runs_status').on(t.status),
  }),
)

export type OnboardingRun = typeof onboardingRuns.$inferSelect
export type NewOnboardingRun = typeof onboardingRuns.$inferInsert

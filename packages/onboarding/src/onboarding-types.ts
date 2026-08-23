// Domain-only types for the `onboarding` package. Per
// `.claude/rules/structure-standard.md` "packages/core/src/".
//
// The DB row types `collectedData` opaquely (`Record<string, unknown>`); the
// core works with the typed contract `CollectedOnboardingData`, casting at the
// few read sites (the chat tool-I/O opaque-JSON precedent). `completedSteps` +
// `currentStepKind` are already the (structurally identical) step union.
//
// Spec: docs/blueprints/onboarding/coding.md §3.

import type { Database } from '@vynel/db'
import type { OnboardingRun, NewOnboardingRun } from '@vynel/db/schema/onboarding'
import type { CollectedOnboardingData } from '@vynel/contracts/onboarding/collected-onboarding-data'
import type { OnboardingStepCatalogEntry } from '@vynel/contracts/onboarding/onboarding-step-catalog'

export type { OnboardingRun, NewOnboardingRun }

// The subset of pino the core logs against (the chat / channels / schedules
// StructuralLogger precedent — core never depends on the full pino type).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

export interface OnboardingRunStatusSnapshot {
  run: OnboardingRun
  currentStep: OnboardingStepCatalogEntry
  totalSteps: number
  completedStepCount: number
  collectedData: CollectedOnboardingData
}

// The sibling ops the step handlers call, injected at the api-edge composition
// point (apps/local-api routes/onboarding/build-onboarding-deps.ts) and typed
// STRUCTURALLY here so the onboarding leaf never imports @vynel/core
// (invariant #2 — no sibling-leaf import; the FireScheduleDeps precedent).
// Two steps since 2026-08-24: only the profile write + the gate flip remain —
// workspaces/memory/skills/channels/schedules got their own in-app doors.
export interface OnboardingDeps {
  logger?: StructuralLogger
  // The profile (name) step + run completion — the boot-created user's row
  // (@vynel/core users ops at the composition point).
  updateUserProfile: (
    db: Database,
    userId: string,
    input: { displayName: string; locale: string; timezone: string },
    deps?: { logger?: StructuralLogger },
  ) => unknown
  markUserOnboardingComplete: (db: Database, userId: string) => unknown
}

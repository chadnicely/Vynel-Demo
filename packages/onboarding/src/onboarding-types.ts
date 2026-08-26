// Domain-only types for the `onboarding` package.
//
// The DB row types `collectedData` opaquely (`Record<string, unknown>`); the
// core works with the typed contract `CollectedOnboardingData`, casting at the
// few read sites (the chat tool-I/O opaque-JSON precedent). `completedSteps` +
// `currentStepKind` are already the (structurally identical) step union.

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

// One memory entry the identity-seed step writes. Declared STRUCTURALLY
// (assignable to @vynel/memory's CreateMemoryEntryInput — narrower literal
// unions) so the leaf never imports the memory leaf, not even type-only
// (invariant #2 — a type import is still a package dependency).
export interface MemorySeedEntry {
  userId: string
  /** Null = a USER-level memory, which is the only shape setup writes: no
   *  workspace exists yet, and these answers are about the person. */
  workspaceId: string | null
  kind: 'note' | 'preference'
  body: string
  category: 'user' | 'preferences' | 'memory'
  section: string
  createdSource: 'onboarding-seed'
}

// The sibling ops the step handlers call, injected at the api-edge composition
// point (apps/local-api routes/onboarding/build-onboarding-deps.ts) and typed
// STRUCTURALLY here — the exact call shapes the handlers invoke — so the
// onboarding leaf never imports @vynel/core / @vynel/memory (invariant #2 — no
// sibling-leaf import; the FireScheduleDeps / ProcessInboundDeps precedent).
// Each handler takes the narrow Pick it needs; the dispatcher threads the whole
// bundle through.
export interface OnboardingDeps {
  logger?: StructuralLogger
  // Step 2 (profile) + run completion — the boot-created user's row.
  updateUserProfile: (
    db: Database,
    userId: string,
    input: { displayName: string; locale: string; timezone: string },
    deps?: { logger?: StructuralLogger },
  ) => unknown
  markUserOnboardingComplete: (db: Database, userId: string) => unknown
  // Step 3 (identity-seed).
  createMemoryEntry: (db: Database, entry: MemorySeedEntry) => unknown
}

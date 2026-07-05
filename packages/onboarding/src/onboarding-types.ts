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
import type { SkillScope } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'

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
  suggestedSkills?: {
    defaultCheckedSkillIds: readonly string[]
    optionalSkillIds: readonly string[]
  }
}

// One memory entry the identity-seed step writes. Declared STRUCTURALLY
// (assignable to @vynel/memory's CreateMemoryEntryInput — narrower literal
// unions) so the leaf never imports the memory leaf, not even type-only
// (invariant #2 — a type import is still a package dependency).
export interface MemorySeedEntry {
  userId: string
  workspaceId: string
  kind: 'note' | 'preference'
  body: string
  category: 'user' | 'preferences' | 'memory'
  section: string
  createdSource: 'onboarding-seed'
}

// The per-skill settings the wizard forwards to an install — mirrors skills'
// ResolvedSkillSettings shape (setting values by settingKey).
export type SkillSettingValues = Record<string, string | number | boolean>

// One skill install the install-suggested-skills step requests. Structurally
// assignable to @vynel/skills' InstallSkillInput.
export interface SkillInstallRequest {
  userId: string
  workspaceId: string
  workspacePath: string
  skillId: string
  scope: SkillScope
  initialSettings?: SkillSettingValues
}

// The sibling ops the step handlers call, injected at the api-edge composition
// point (apps/local-api routes/onboarding/build-onboarding-deps.ts) and typed
// STRUCTURALLY here — the exact call shapes the handlers invoke — so the
// onboarding leaf never imports @vynel/workspaces / @vynel/core / @vynel/memory
// / @vynel/skills / @vynel/channels / @vynel/schedules (invariant #2 — no
// sibling-leaf import; the FireScheduleDeps / ProcessInboundDeps precedent).
// Each handler takes the narrow Pick it needs; the dispatcher threads the whole
// bundle through.
export interface OnboardingDeps {
  logger?: StructuralLogger
  // Step 3 (name-workspace): where the fresh folder goes + how its name is
  // made filesystem-safe. The api edge binds makeDefaultWorkspaceParentDirectory
  // + sanitizeFolderName from @vynel/workspaces.
  resolveDefaultWorkspaceLocation: () => string
  sanitizeFolderName: (rawName: string) => string
  createWorkspace: (
    db: Database,
    input: { userId: string; name: string; directory: string },
    deps?: { logger?: StructuralLogger },
  ) => Promise<{ id: string; path: string }>
  // Step 2 (profile) + run completion — the boot-created user's row
  // (@vynel/core users ops at the composition point).
  updateUserProfile: (
    db: Database,
    userId: string,
    input: { displayName: string; locale: string; timezone: string },
    deps?: { logger?: StructuralLogger },
  ) => unknown
  markUserOnboardingComplete: (db: Database, userId: string) => unknown
  // Step 4 (identity-seed).
  createMemoryEntry: (db: Database, entry: MemorySeedEntry) => unknown
  // Step 5 (install-suggested-skills).
  installSkill: (
    db: Database,
    input: SkillInstallRequest,
    deps?: { logger?: StructuralLogger },
  ) => Promise<unknown>
  // Step 6 (optional-channel). `botCredentials` mirrors channels' BotCredentials.
  connectChannel: (
    db: Database,
    input: {
      userId: string
      workspaceId: string | null
      channelKind: 'telegram'
      displayName: string
      botCredentials: Record<string, string>
      initialAllowedSenderId?: string
    },
    deps?: { logger?: StructuralLogger },
  ) => Promise<{ id: string }>
  // Step 7 (optional-schedule).
  createSchedule: (
    db: Database,
    input: {
      userId: string
      workspaceId: string | null
      templateKind: 'morning-briefing'
      cronExpression: string
      timezone: string
      destinationKind: 'chat-only' | 'chat-and-channel'
      channelId?: string
    },
    deps?: { logger?: StructuralLogger },
  ) => unknown
}

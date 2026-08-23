// The onboarding step catalog — typed constants consumed by BOTH the api
// (route validators + the dispatcher) and the apps/web wizard, so they live
// in `@vynel/contracts` (file-level subpaths, no barrel). `@vynel/contracts`
// has NO `@vynel/db` dependency.
//
// TWO steps since 2026-08-24 (the user's call): welcome + the name. The five
// later steps (name-workspace, identity-seed, install-suggested-skills,
// optional-channel, optional-schedule) were retired — workspaces, skills,
// channels, and schedules each have their own richer in-app door now, and
// first launch should not front-load them. A run parked on a retired step
// self-heals at start (`startOnboardingRun`).

export type OnboardingStepKind = 'welcome' | 'profile'

export interface OnboardingStepCatalogEntry {
  stepKind: OnboardingStepKind
  order: number // 1-indexed display order
  isSkippable: boolean
  displayLabel: string
  oneLineDescription: string
}

export const ONBOARDING_STEP_CATALOG = [
  { stepKind: 'welcome', order: 1, isSkippable: false, displayLabel: 'Welcome', oneLineDescription: 'A quick intro to Vynel.' },
  { stepKind: 'profile', order: 2, isSkippable: false, displayLabel: 'Your profile', oneLineDescription: 'Tell us who you are.' },
] as const satisfies readonly OnboardingStepCatalogEntry[]

export function findOnboardingStepByKind(stepKind: string): OnboardingStepCatalogEntry | null {
  return ONBOARDING_STEP_CATALOG.find((s) => s.stepKind === stepKind) ?? null
}

export function getNextOnboardingStep(currentKind: OnboardingStepKind): OnboardingStepKind | null {
  const current = findOnboardingStepByKind(currentKind)
  if (!current) return null
  return ONBOARDING_STEP_CATALOG.find((s) => s.order === current.order + 1)?.stepKind ?? null
}

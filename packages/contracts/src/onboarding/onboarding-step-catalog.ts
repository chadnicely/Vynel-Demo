// The first-launch flow — five screens (Chad, 2026-08-24; Kafi 2026-08-27
// dropped the "Name your workspace" step: setup no longer creates a folder or
// a workspace, the "new or existing?" question after the finish line does).
//
// Two of main's own, then "Help Vynel know you" (its answers become user-level
// memory), then Chad's two Welcome-prototype screens: "Connect a brain"
// (Claude, the only brain that builds today) and "A safe copy on GitHub"
// (skippable — a user with no GitHub account is never walled out of setup).
//
// Step LABELS are Vynel's own voice — the model's name never appears in one
// (the brain step legitimately names providers on screen, not in its label).

export type OnboardingStepKind =
  | 'welcome'
  | 'profile'
  | 'identity-seed'
  | 'connect-brain'
  | 'github-backup'

export interface OnboardingStepCatalogEntry {
  stepKind: OnboardingStepKind
  order: number // 1-indexed display order
  isSkippable: boolean
  displayLabel: string
  oneLineDescription: string
}

export const ONBOARDING_STEP_CATALOG = [
  { stepKind: 'welcome', order: 1, isSkippable: false, displayLabel: 'Hello — welcome to Vynel', oneLineDescription: 'What Vynel is, in three lines.' },
  { stepKind: 'profile', order: 2, isSkippable: false, displayLabel: 'Your profile', oneLineDescription: 'Tell us who you are.' },
  { stepKind: 'identity-seed', order: 3, isSkippable: false, displayLabel: 'Help Vynel know you', oneLineDescription: 'Answer a few questions so Vynel can start with context.' },
  { stepKind: 'connect-brain', order: 4, isSkippable: false, displayLabel: 'Connect a brain', oneLineDescription: 'Vynel builds with your own AI account.' },
  { stepKind: 'github-backup', order: 5, isSkippable: true, displayLabel: 'A safe copy on GitHub', oneLineDescription: 'Keep every project’s history somewhere safe. (Optional)' },
] as const satisfies readonly OnboardingStepCatalogEntry[]

// Widened to `string` on purpose: a run parked on a RETIRED kind (an old row
// from the seven-step flow) must read as unknown so `startOnboardingRun`
// self-heals it instead of resuming a dead screen.
export function findOnboardingStepByKind(stepKind: string): OnboardingStepCatalogEntry | null {
  return ONBOARDING_STEP_CATALOG.find((s) => s.stepKind === stepKind) ?? null
}

export function getNextOnboardingStep(currentKind: OnboardingStepKind): OnboardingStepKind | null {
  const current = findOnboardingStepByKind(currentKind)
  if (!current) return null
  return ONBOARDING_STEP_CATALOG.find((s) => s.order === current.order + 1)?.stepKind ?? null
}

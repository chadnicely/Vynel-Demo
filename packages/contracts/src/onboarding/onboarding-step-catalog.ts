// The onboarding step catalog — typed constants consumed by BOTH the api
// (route validators + the dispatcher) and the apps/web wizard, so they live
// in `@vynel/contracts` (file-level subpaths, no barrel). `@vynel/contracts`
// has NO `@vynel/db` dependency.

export type OnboardingStepKind =
  | 'welcome'
  | 'profile'
  | 'name-workspace'
  | 'identity-seed'
  | 'install-suggested-skills'
  | 'optional-channel'
  | 'optional-schedule'

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
  { stepKind: 'name-workspace', order: 3, isSkippable: false, displayLabel: 'Name your workspace', oneLineDescription: 'Give your workspace a name.' },
  { stepKind: 'identity-seed', order: 4, isSkippable: false, displayLabel: 'Help Claude know you', oneLineDescription: 'Answer a few questions so Claude can start with context.' },
  { stepKind: 'install-suggested-skills', order: 5, isSkippable: false, displayLabel: 'Install starter skills', oneLineDescription: 'Pick the skills you want available right away.' },
  { stepKind: 'optional-channel', order: 6, isSkippable: true, displayLabel: 'Connect a chat app', oneLineDescription: 'Talk to your workspace from Telegram. (Optional)' },
  { stepKind: 'optional-schedule', order: 7, isSkippable: true, displayLabel: 'Set a daily briefing', oneLineDescription: 'Get a morning summary every day. (Optional)' },
] as const satisfies readonly OnboardingStepCatalogEntry[]

export function findOnboardingStepByKind(stepKind: OnboardingStepKind): OnboardingStepCatalogEntry | null {
  return ONBOARDING_STEP_CATALOG.find((s) => s.stepKind === stepKind) ?? null
}

export function getNextOnboardingStep(currentKind: OnboardingStepKind): OnboardingStepKind | null {
  const current = findOnboardingStepByKind(currentKind)
  if (!current) return null
  return ONBOARDING_STEP_CATALOG.find((s) => s.order === current.order + 1)?.stepKind ?? null
}

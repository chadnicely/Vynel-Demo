// `restartOnboardingRun` — marks every in-progress run for the user
// `abandoned`, then starts fresh. Does NOT touch the user / workspace / sibling
// artifacts (decisions.md D11). Sync. Spec: blueprint.md §6.1.

import type { Database } from '@vynel/db'
import {
  listInProgressRunsForUser,
  updateOnboardingRun,
  type OnboardingRun,
} from '@vynel/db/repositories/onboarding'
import { startOnboardingRun } from './start-onboarding-run.js'

export function restartOnboardingRun(db: Database, userId: string): OnboardingRun {
  for (const run of listInProgressRunsForUser(db, userId)) {
    updateOnboardingRun(db, run.id, { status: 'abandoned', lastActivityAt: new Date() })
  }
  return startOnboardingRun(db, userId)
}

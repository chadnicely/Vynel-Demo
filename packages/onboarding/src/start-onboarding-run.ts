// `startOnboardingRun` — returns the existing in-progress run for the user if
// any (find-or-create); otherwise inserts a fresh `welcome` run with `userId`
// stamped (D14 — the single user exists from boot). A run parked on a RETIRED
// step (the pre-2026-08-24 seven-step flow) self-heals here: it is abandoned
// and a fresh two-step run begins — resuming it would strand the wizard on a
// screen that no longer exists. Sync. Spec: blueprint.md §6.1.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import {
  findInProgressRunForUser,
  insertOnboardingRun,
  updateOnboardingRun,
  type OnboardingRun,
} from '@vynel/db/repositories/onboarding'
import { findOnboardingStepByKind } from '@vynel/contracts/onboarding/onboarding-step-catalog'

export function startOnboardingRun(db: Database, userId: string): OnboardingRun {
  const inProgress = findInProgressRunForUser(db, userId)
  if (inProgress) {
    if (findOnboardingStepByKind(inProgress.currentStepKind) !== null) return inProgress
    updateOnboardingRun(db, inProgress.id, { status: 'abandoned', lastActivityAt: new Date() })
  }

  const now = new Date()
  return insertOnboardingRun(db, {
    id: randomUUID(),
    userId,
    workspaceId: null,
    currentStepKind: 'welcome',
    completedSteps: [],
    collectedData: {},
    status: 'in-progress',
    startedAt: now,
    lastActivityAt: now,
    completedAt: null,
  })
}

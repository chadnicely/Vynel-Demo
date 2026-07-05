// `startOnboardingRun` — returns the existing in-progress run for the user if
// any (find-or-create); otherwise inserts a fresh `welcome` run with `userId`
// stamped (D14 — the single user exists from boot). Sync. Spec: blueprint.md §6.1.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import {
  findInProgressRunForUser,
  insertOnboardingRun,
  type OnboardingRun,
} from '@vynel/db/repositories/onboarding'

export function startOnboardingRun(db: Database, userId: string): OnboardingRun {
  const inProgress = findInProgressRunForUser(db, userId)
  if (inProgress) return inProgress

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

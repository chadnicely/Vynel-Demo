// Functional repository for the `onboarding_runs` table. `db` is the first
// argument (per `docs/foundation.md §2 row 3`); Phase 1 SYNC returns per
// `.claude/memory/decisions/phase-1-sync-transactions.md`. Every read filters
// on `userId`. No raw SQL or Drizzle queries outside this repo.
//
// Spec: `docs/blueprints/onboarding/blueprint.md §5`.

import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  onboardingRuns,
  type OnboardingRun,
  type NewOnboardingRun,
} from '../../schema/onboarding/onboarding-runs.js'

// Re-export row + union types so `@vynel/core/onboarding` can import them via
// the schema barrel (the schedules/chat repo precedent).
export type {
  OnboardingRun,
  NewOnboardingRun,
  OnboardingRunStatus,
} from '../../schema/onboarding/onboarding-runs.js'

export function insertOnboardingRun(db: Database, row: NewOnboardingRun): OnboardingRun {
  const inserted = db.insert(onboardingRuns).values(row).returning().get()
  if (!inserted) throw new Error('insertOnboardingRun: insert returned no row')
  return inserted
}

export function findOnboardingRunById(db: Database, id: string): OnboardingRun | null {
  return db.select().from(onboardingRuns).where(eq(onboardingRuns.id, id)).get() ?? null
}

// At most one in-progress run per user (startOnboardingRun enforces it); the
// `desc(startedAt)` + `.get()` is a defensive single-row pick.
export function findInProgressRunForUser(db: Database, userId: string): OnboardingRun | null {
  return (
    db
      .select()
      .from(onboardingRuns)
      .where(and(eq(onboardingRuns.userId, userId), eq(onboardingRuns.status, 'in-progress')))
      .orderBy(desc(onboardingRuns.startedAt))
      .get() ?? null
  )
}

export function listInProgressRunsForUser(db: Database, userId: string): OnboardingRun[] {
  return db
    .select()
    .from(onboardingRuns)
    .where(and(eq(onboardingRuns.userId, userId), eq(onboardingRuns.status, 'in-progress')))
    .all()
}

export function updateOnboardingRun(
  db: Database,
  id: string,
  patch: Partial<NewOnboardingRun>,
): OnboardingRun {
  const updated = db
    .update(onboardingRuns)
    .set(patch)
    .where(eq(onboardingRuns.id, id))
    .returning()
    .get()
  if (!updated) throw new Error(`updateOnboardingRun: no row for id ${id}`)
  return updated
}

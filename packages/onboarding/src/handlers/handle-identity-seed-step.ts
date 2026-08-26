// Step 3 (identity-seed) — seeds the user's answers DIRECTLY into structured
// memory via the injected `createMemoryEntry` (OnboardingDeps — invariant #2:
// no sibling-leaf import of @vynel/memory). The answers become facts the agent
// sees through the memory capability.
//
// Setup creates no workspace, so `run.workspaceId` is null here by design and
// the answers land as USER-level memory — which is what they are: they are
// about the person, and follow them into every project they ever make.

import type { Database } from '@vynel/db'
import type { IdentitySeedStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import { advanceRun } from '../advance-run.js'
import { buildMemorySeedEntries } from '../seeding/build-memory-seed-entries.js'
import type { OnboardingDeps, OnboardingRun } from '../onboarding-types.js'

export function handleIdentitySeedStep(
  db: Database,
  run: OnboardingRun,
  input: IdentitySeedStepInput,
  deps: Pick<OnboardingDeps, 'logger' | 'createMemoryEntry'>,
): OnboardingRun {
  const entries = buildMemorySeedEntries({
    userId: run.userId,
    workspaceId: run.workspaceId,
    answers: input,
  })
  for (const entry of entries) {
    deps.createMemoryEntry(db, entry)
  }
  deps.logger?.info({ userId: run.userId, entries: entries.length }, 'onboarding: memory seeded')

  return advanceRun(db, run, 'identity-seed', input)
}

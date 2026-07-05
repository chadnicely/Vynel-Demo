// Step 4 (identity-seed) — seeds the user's answers DIRECTLY into structured
// memory via the injected `createMemoryEntry` (OnboardingDeps — invariant #2:
// no sibling-leaf import of @vynel/memory). No more identity .md files (A2:
// retire identity files); the answers become workspace-scoped memory facts the
// agent sees via the memory capability. The op is sync (Phase 1 DB write); the
// handler stays async to match the dispatcher contract. Spec: blueprint.md §6.4
// + §7 (revised — DB-as-source).

import type { Database } from '@vynel/db'
import type { IdentitySeedStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import { advanceRun } from '../advance-run.js'
import { buildMemorySeedEntries } from '../seeding/build-memory-seed-entries.js'
import { OnboardingStepOutOfOrderError } from '../onboarding-errors.js'
import type { OnboardingDeps, OnboardingRun } from '../onboarding-types.js'

export async function handleIdentitySeedStep(
  db: Database,
  run: OnboardingRun,
  input: IdentitySeedStepInput,
  deps: Pick<OnboardingDeps, 'logger' | 'createMemoryEntry'>,
): Promise<OnboardingRun> {
  if (!run.workspaceId) {
    throw new OnboardingStepOutOfOrderError('workspace must exist first')
  }

  const entries = buildMemorySeedEntries({
    userId: run.userId,
    workspaceId: run.workspaceId,
    answers: input,
  })
  for (const entry of entries) {
    deps.createMemoryEntry(db, entry)
  }

  return advanceRun(db, run, 'identity-seed', input)
}

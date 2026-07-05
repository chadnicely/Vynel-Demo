// Step 3 (name-workspace) handler — a brand-new user has no folder yet, so this
// step CREATES one (default location + sanitized name) and then registers it via
// the existing-directory `createWorkspace` op. The workspaces ops are injected
// via OnboardingDeps (invariant #2 — no sibling-leaf import). Async.
// Spec: blueprint.md §6.4.

import path from 'node:path'
import { mkdirSync } from 'node:fs'
import type { Database } from '@vynel/db'
import type { NameWorkspaceStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import { advanceRun } from '../advance-run.js'
import type { OnboardingDeps, OnboardingRun } from '../onboarding-types.js'

export async function handleNameWorkspaceStep(
  db: Database,
  run: OnboardingRun,
  input: NameWorkspaceStepInput,
  deps: Pick<
    OnboardingDeps,
    'logger' | 'resolveDefaultWorkspaceLocation' | 'sanitizeFolderName' | 'createWorkspace'
  >,
): Promise<OnboardingRun> {
  // Create the fresh folder for the new user, then register it. The manual
  // create-workspace flow adopts an existing directory; onboarding makes one
  // first (default location + sanitized name) so the same op can adopt it.
  const directory = path.join(
    deps.resolveDefaultWorkspaceLocation(),
    deps.sanitizeFolderName(input.name),
  )
  mkdirSync(directory, { recursive: true })

  const workspace = await deps.createWorkspace(
    db,
    { userId: run.userId, name: input.name, directory },
    deps,
  )

  return advanceRun(db, run, 'name-workspace', input, {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
  })
}

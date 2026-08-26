// Step 5 (github-backup) — "A safe copy on GitHub" (Chad's Welcome prototype,
// 2026-08-24).
//
// Like connect-brain, the sign-in itself runs through the existing GitHub
// device-flow routes: `gh` holds the token and Vynel never sees it. This step
// records only the outcome the user reached.
//
// Skipping is a real answer, not a failure — the prototype's own words are
// "Skip this — Vynel will offer it again the first time it matters", and a
// user with no GitHub account must never be walled out of setup.

import type { Database } from '@vynel/db'
import type { GitHubBackupStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import { advanceRun } from '../advance-run.js'
import type { OnboardingDeps, OnboardingRun } from '../onboarding-types.js'

export function handleGitHubBackupStep(
  db: Database,
  run: OnboardingRun,
  input: GitHubBackupStepInput,
  deps: Pick<OnboardingDeps, 'logger'>,
): OnboardingRun {
  deps.logger?.info({ userId: run.userId, kind: input.kind }, 'onboarding: github backup')
  return advanceRun(db, run, 'github-backup', input)
}

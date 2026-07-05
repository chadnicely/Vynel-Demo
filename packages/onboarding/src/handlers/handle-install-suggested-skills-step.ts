// Step 5 (install-suggested-skills) handler — installs each selected Verified
// skill at its recommended scope via the injected `installSkill` (OnboardingDeps
// — invariant #2: no sibling-leaf import of @vynel/skills). Failures are
// NON-fatal (logged + skipped) so one bad install doesn't kill onboarding (D8).
// Skips unknown + system skills. Async. Spec: blueprint.md §6.4 + coding.md §4.

import type { Database } from '@vynel/db'
import type { InstallSuggestedSkillsStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import type { CollectedOnboardingData } from '@vynel/contracts/onboarding/collected-onboarding-data'
import { findVerifiedSkillById } from '@vynel/contracts/skills/verified-skills/verified-skill-catalog'
import { advanceRun } from '../advance-run.js'
import { OnboardingStepOutOfOrderError } from '../onboarding-errors.js'
import type {
  OnboardingDeps,
  OnboardingRun,
  SkillInstallRequest,
  SkillSettingValues,
} from '../onboarding-types.js'

export async function handleInstallSuggestedSkillsStep(
  db: Database,
  run: OnboardingRun,
  input: InstallSuggestedSkillsStepInput,
  deps: Pick<OnboardingDeps, 'logger' | 'installSkill'>,
): Promise<OnboardingRun> {
  const collected = run.collectedData as unknown as CollectedOnboardingData
  if (!run.workspaceId || !collected.workspacePath) {
    throw new OnboardingStepOutOfOrderError('workspace must exist first')
  }

  for (const skillId of input.skillIdsToInstall) {
    const definition = findVerifiedSkillById(skillId)
    if (!definition || definition.isSystemInstalled) {
      deps.logger?.warn({ skillId }, 'skipping unknown or system skill during onboarding')
      continue
    }

    const installInput: SkillInstallRequest = {
      userId: run.userId,
      workspaceId: run.workspaceId,
      workspacePath: collected.workspacePath,
      skillId,
      scope: definition.recommendedScope,
    }
    const settings = input.skillSettingsBySkillId?.[skillId]
    if (settings) installInput.initialSettings = settings as unknown as SkillSettingValues

    try {
      await deps.installSkill(db, installInput, deps)
    } catch (err) {
      deps.logger?.warn({ err, skillId }, 'skill install failed during onboarding; continuing')
    }
  }

  return advanceRun(db, run, 'install-suggested-skills', input)
}

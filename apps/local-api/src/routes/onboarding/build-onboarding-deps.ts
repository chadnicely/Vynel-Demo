// Builds the `OnboardingDeps` the onboarding step handlers run against. This is
// the api-edge composition point (the build-schedule-fire-deps precedent): it
// binds the REAL sibling ops — workspaces folder/registration, core-users
// profile + gate flip, memory seeding, skill install, channel connect, schedule
// create — that the onboarding LEAF declares only structurally so it never
// imports a sibling package (invariant #2). Apps may import anything.

import {
  createWorkspace,
  sanitizeFolderName,
  makeDefaultWorkspaceParentDirectory,
} from '@vynel/workspaces'
import { updateUserProfile, markUserOnboardingComplete } from '@vynel/core/users'
import { createMemoryEntry } from '@vynel/memory'
import { installSkill } from '@vynel/skills'
import { connectChannel } from '@vynel/channels'
import { createSchedule } from '@vynel/schedules'
import type { OnboardingDeps } from '@vynel/onboarding'
import type { Logger } from 'pino'

export function buildOnboardingDeps(logger: Logger): OnboardingDeps {
  return {
    logger,
    resolveDefaultWorkspaceLocation: makeDefaultWorkspaceParentDirectory,
    sanitizeFolderName,
    createWorkspace,
    updateUserProfile,
    markUserOnboardingComplete,
    createMemoryEntry,
    installSkill,
    connectChannel,
    createSchedule,
  }
}

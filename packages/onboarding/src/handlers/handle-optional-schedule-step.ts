// Step 7 (optional-schedule) handler — `skipped` advances; otherwise creates a
// morning-briefing schedule via the injected SYNC `createSchedule`
// (OnboardingDeps — invariant #2: no sibling-leaf import of @vynel/schedules).
// destinationKind = chat-and-channel when a channel id is present, else
// chat-only. This is the last step → advanceRun completes the run.
// Sync. Spec: blueprint.md §6.4.

import type { Database } from '@vynel/db'
import type { OptionalScheduleStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import type { CollectedOnboardingData } from '@vynel/contracts/onboarding/collected-onboarding-data'
import { advanceRun } from '../advance-run.js'
import { OnboardingStepOutOfOrderError } from '../onboarding-errors.js'
import type { OnboardingDeps, OnboardingRun } from '../onboarding-types.js'

export function handleOptionalScheduleStep(
  db: Database,
  run: OnboardingRun,
  input: OptionalScheduleStepInput,
  deps: Pick<OnboardingDeps, 'logger' | 'createSchedule'>,
): OnboardingRun {
  if (input.kind === 'skipped') {
    return advanceRun(db, run, 'optional-schedule', input)
  }
  if (!run.workspaceId) throw new OnboardingStepOutOfOrderError('workspace must exist first')

  const collected = run.collectedData as unknown as CollectedOnboardingData
  const timezone = input.timezone ?? collected.profile?.timezone ?? 'UTC'
  const destinationKind = input.channelId ? 'chat-and-channel' : 'chat-only'

  deps.createSchedule(
    db,
    {
      userId: run.userId,
      workspaceId: run.workspaceId,
      templateKind: 'morning-briefing',
      cronExpression: `0 ${input.fireHour} * * *`,
      timezone,
      destinationKind,
      ...(input.channelId ? { channelId: input.channelId } : {}),
    },
    deps,
  )

  return advanceRun(db, run, 'optional-schedule', input)
}

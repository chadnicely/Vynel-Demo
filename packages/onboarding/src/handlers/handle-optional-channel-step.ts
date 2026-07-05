// Step 6 (optional-channel) handler — `skipped` advances; `connect` calls the
// injected `connectChannel` (OnboardingDeps — invariant #2: no sibling-leaf
// import of @vynel/channels; Telegram only, Phase 1) and stashes the channelId.
// A bad token re-throws so the wizard shows the error + lets the user
// retry/skip. Async. Spec: blueprint.md §6.4.

import type { Database } from '@vynel/db'
import type { OptionalChannelStepInput } from '@vynel/contracts/onboarding/onboarding-step-inputs'
import { advanceRun } from '../advance-run.js'
import { OnboardingStepOutOfOrderError } from '../onboarding-errors.js'
import type { OnboardingDeps, OnboardingRun } from '../onboarding-types.js'

export async function handleOptionalChannelStep(
  db: Database,
  run: OnboardingRun,
  input: OptionalChannelStepInput,
  deps: Pick<OnboardingDeps, 'logger' | 'connectChannel'>,
): Promise<OnboardingRun> {
  if (input.kind === 'skipped') {
    return advanceRun(db, run, 'optional-channel', input)
  }
  if (!run.workspaceId) throw new OnboardingStepOutOfOrderError('workspace must exist first')

  const channel = await deps.connectChannel(
    db,
    {
      userId: run.userId,
      workspaceId: run.workspaceId,
      channelKind: input.channelKind,
      displayName: input.displayName,
      botCredentials: input.botCredentials,
      ...(input.initialAllowedSenderId ? { initialAllowedSenderId: input.initialAllowedSenderId } : {}),
    },
    deps,
  )

  return advanceRun(db, run, 'optional-channel', input, { channelId: channel.id })
}

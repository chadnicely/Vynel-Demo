// The `onboarding` domain's specialized `VynelError` subclasses. The two
// state-machine errors carry DISTINCT codes the wizard branches on
// (already-complete → redirect to the app; step-kind mismatch → resync to the
// current step). They extend
// `VynelError` DIRECTLY with an explicit `code` + `httpStatus`, matching the
// `IdentityFileParseError` precedent — the generic subclasses declare `code`
// as a literal (`'conflict'`, `'validation_failed'`), so extending them and
// overriding `code` does not typecheck. The HTTP semantics (409 / 400) are
// preserved via the explicit `httpStatus`.
//
// "Run not found / not owned" uses the generic `NotFoundError('onboarding-run',
// id)` directly — no class here.
//
// Spec: `docs/blueprints/onboarding/blueprint.md §6.5` + coding.md §5.

import { VynelError } from '@vynel/errors'

export class OnboardingRunAlreadyCompletedError extends VynelError {
  readonly code = 'onboarding_run_already_completed'
  readonly httpStatus = 409

  constructor(public readonly runId: string) {
    super(`This onboarding is already complete. Open the app to continue.`)
  }
}

export class OnboardingStepKindMismatchError extends VynelError {
  readonly code = 'onboarding_step_kind_mismatch'
  readonly httpStatus = 400

  constructor(
    public readonly expected: string,
    public readonly received: string,
  ) {
    super(`This step is out of date — reload to continue from "${expected}".`)
  }
}


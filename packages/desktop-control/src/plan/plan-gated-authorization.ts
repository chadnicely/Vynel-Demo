// The act tools' side of plan-level approval, in one home so both tools stay
// word-for-word consistent: (1) the plan-first refusal — no armed plan, no
// acting, in EVERY mode (that is what guarantees the overlay always has a plan
// to narrate; ask mode merely adds the card) — and (2) the composed authorizer
// that lets the armed envelope satisfy an act the way a standing grant would.
//
// Composition order: envelope first (the turn's fresh consent), then the
// standing per-app grant gate. The envelope check is a boolean, never a throw —
// a miss falls through to `assertDesktopAccess`, whose ForbiddenError is then
// re-raised with the plan recovery path appended, so a denied act always names
// BOTH doors (update the plan, or request standing access).

import { ForbiddenError } from '@vynel/errors'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'
import type { DesktopPlanEnvelope } from './desktop-plan-envelope.js'

export const PLAN_REQUIRED_MESSAGE =
  'Desktop acting requires a plan. Call propose_desktop_plan({ goal, steps, apps: [{ app, tier }] }) ' +
  'first — the user approves the WHOLE plan once (in ask mode), then these actions run without ' +
  'per-step approval cards. List every app the plan touches, at the lowest tier that works.'

/** The act tools' pre-flight: refuse until the turn's plan is armed. */
export function planRequiredError(envelope: DesktopPlanEnvelope): string | null {
  return envelope.isArmed() ? null : PLAN_REQUIRED_MESSAGE
}

/**
 * An authorizer that consults the armed plan before the standing grants.
 * Called by the execution adapters AFTER resolving the real target app, so
 * coordinate confinement + hit-test identity keep their guarantees.
 */
export function makePlanGatedAuthorizer(
  envelope: DesktopPlanEnvelope,
  standingAuthorize?: DesktopAccessAuthorizer,
): DesktopAccessAuthorizer {
  return (resolvedAppName, required) => {
    if (envelope.authorizesApp(resolvedAppName, required)) return
    if (standingAuthorize === undefined) return
    try {
      standingAuthorize(resolvedAppName, required)
    } catch (err) {
      if (err instanceof ForbiddenError) {
        throw new ForbiddenError(
          `${err.message} Or propose an updated plan (propose_desktop_plan) that lists ` +
            `"${resolvedAppName}" at tier "${required}" — the user approves the change once.`,
        )
      }
      throw err
    }
  }
}

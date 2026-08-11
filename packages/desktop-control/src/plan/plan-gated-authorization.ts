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

export const TASK_BUDGET_SPENT_MESSAGE =
  'This desktop task has been running too long and has been stopped. Nothing is broken — but a ' +
  'task that keeps acting without finishing is usually stuck repeating something that will not ' +
  'work, and while it runs the user cannot easily interrupt it. Do NOT simply retry, and do NOT ' +
  're-propose the same plan to buy more time: the clock does not reset. Look at the screen ' +
  '(snapshot_app / screenshot_app), tell the user plainly where it got to and what is blocking ' +
  'it, and let them decide.'

/** The act tools' pre-flight: refuse until the turn's plan is armed, and stop
 *  once the task has outrun its budget. */
export function planRequiredError(envelope: DesktopPlanEnvelope): string | null {
  if (!envelope.isArmed()) return PLAN_REQUIRED_MESSAGE
  // Checked here rather than per-tool so every acting path inherits it from the
  // one pre-flight they already share.
  return envelope.hasOutrunBudget() ? TASK_BUDGET_SPENT_MESSAGE : null
}

export const UNATTENDED_REFUSAL_MESSAGE =
  'This reads or replaces the system clipboard, which belongs to the whole computer and can hold ' +
  'something private (a password the user copied, a one-time code). It is only available on a turn ' +
  'the user is present for, and this turn is running unattended, so it was refused. Work from what ' +
  'is on screen instead (snapshot_app / screenshot_app), or tell the user this step needs them.'

/**
 * The gate for an APP-LESS action — today, the clipboard.
 *
 * WHY this exists separately. Every other act tool has TWO doors: the armed
 * envelope, then `assertDesktopAccess` against a standing per-app grant. An
 * app-less tool has no second door, so `isArmed()` would be its ENTIRE
 * authorization — and arming is something the model does to itself:
 * `propose_desktop_plan` cards in ask mode only, so on a channel, spawned, or
 * scheduled turn the model proposes a plan uncarded, the envelope arms, and the
 * clipboard opens. No card, no grant, and nobody at the machine to see the
 * overlay say so. That is precisely the "a background turn can never self-grant"
 * rule, and `desktop-plan-envelope.ts` already promises the unattended envelope
 * "narrates but never grants".
 *
 * So an app-less action additionally requires that the envelope carry real
 * consent: an approved card (ask), or the user's own auto/bypass. Under
 * `display-only` it refuses. Same reasoning for the WRITE, which is its own
 * harm — text planted on an unattended user's clipboard is pasted later in the
 * belief that it is what they copied.
 */
export function unattendedRefusalError(envelope: DesktopPlanEnvelope): string | null {
  const armed = planRequiredError(envelope)
  if (armed !== null) return armed
  return envelope.consent === 'display-only' ? UNATTENDED_REFUSAL_MESSAGE : null
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

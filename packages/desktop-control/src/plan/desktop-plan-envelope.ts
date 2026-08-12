// The turn-scoped plan envelope — the state behind plan-level approval. The
// desktop MCP server is built fresh for every turn, so one envelope instance
// lives exactly as long as the turn: `propose_desktop_plan` arms it (replacing
// any earlier plan this turn), the act tools refuse until it is armed, and it
// vanishes with the turn — no schema, no persistence, nothing to revoke.
//
// Whether an ARMED envelope may also AUTHORIZE its apps (the one-time grant)
// depends on the turn's consent mode: an approved card or the user's own
// auto/bypass mode says yes; an unattended turn says no — there the envelope
// only narrates, and standing grants remain the single authority.
//
// App matching is EXACT-normalized-key only, the same rationale as the grant
// model: the approval card names what gets authorized, so fuzzy matching would
// authorize something the card never showed. Plans may name a not-yet-open app
// (launch arrives in a later arc), so nothing here touches the live window
// list — enforcement stays at act time, against the RESOLVED target app.

import type { DesktopPlanConsent } from '@vynel/mcp-contract'
import {
  normalizeDesktopAppKey,
  tierAllows,
  type DesktopAccessTier,
} from '../access/desktop-access-tiers.js'

export type DesktopPlanApp = {
  /** The app name as shown on the approval card — matched by normalized key. */
  app: string
  tier: DesktopAccessTier
}

export type DesktopPlan = {
  /** One sentence: what the user asked for. The card's headline. */
  goal: string
  /** Short human-readable steps, shown on the card and narrated by the overlay. */
  steps: string[]
  /** Every app the plan will act on, each at the lowest tier that does the job. */
  apps: DesktopPlanApp[]
}

/**
 * How long one desktop task may keep acting before it must stop and re-think.
 *
 * WHY a watchdog. Nothing bounds a turn today — no step cap, no wall clock, no
 * cost ceiling — which is what makes long autopilot work possible AND what makes
 * a stuck one dangerous: a model clicking a button that never responds runs
 * until a human notices. That is fine when someone is watching; a spawned
 * session working while the user is away is exactly when nobody is.
 *
 * Deliberately scoped to the DESKTOP task rather than the turn: it lives in the
 * envelope that already dies with the turn, so it needs no session-backbone
 * change, and it bounds the thing that actually touches the user's machine.
 *
 * Generous on purpose — a real task (open an app, log in, fill a form, save)
 * lands well inside it, so hitting this means something is wrong, not that the
 * work was big. The model is told to re-observe and re-plan, not merely retry:
 * retrying is what got it here.
 *
 * ⚠ IT MUST STAY BELOW `DELEGATION_RUN_BUDGET_MS` (10 min, in
 * `packages/session/.../run-delegation-claim-and-run-tick.ts`), AND BY A MARGIN.
 * The two clocks start at different moments: the delegation budget runs from the
 * job being CLAIMED, this one from the plan being FIRST ARMED — which is always
 * later, because the model has to read the request and propose a plan before it
 * can arm anything. At 10 minutes each, the delegation deadline therefore always
 * arrived first and this watchdog could never fire on a delegated turn — exactly
 * the unattended case it was written for. Identical numbers looked deliberate
 * and were the bug.
 *
 * Six minutes of CONTINUOUS ACTING is still generous (a click or keystroke is
 * milliseconds; even several `wait_for` calls at the 120s cap fit), and the four
 * minutes of headroom are not slack — they are what lets the model do what the
 * timeout message asks: stop, look at the screen, and TELL THE USER where it got
 * to. A watchdog that fires with no time left to report is just a silent death.
 */
export const DESKTOP_TASK_BUDGET_MS = 6 * 60 * 1000

export type DesktopPlanEnvelope = {
  readonly consent: DesktopPlanConsent
  /** Arm (or replace) the turn's plan. In ask mode the call that reaches this
   *  was already approved on a card — arming is the recording of that consent. */
  arm(plan: DesktopPlan): void
  isArmed(): boolean
  armedPlan(): DesktopPlan | null
  /** Whether the armed plan authorizes an act on the RESOLVED app at the
   *  required tier. Always false under 'display-only' consent — an unattended
   *  plan narrates but never grants. */
  authorizesApp(resolvedAppName: string, required: DesktopAccessTier): boolean
  /** Milliseconds this task has been running, measured from when its plan was
   *  first armed. Null before that — nothing is acting yet. */
  elapsedMs(): number | null
  /** True once the task has outrun its budget. The act tools refuse from here. */
  hasOutrunBudget(): boolean
}

export function createDesktopPlanEnvelope(
  consent: DesktopPlanConsent,
  options: { budgetMs?: number; now?: () => number } = {},
): DesktopPlanEnvelope {
  let plan: DesktopPlan | null = null
  let armedAtMs: number | null = null
  const now = options.now ?? Date.now
  const budgetMs = options.budgetMs ?? DESKTOP_TASK_BUDGET_MS
  return {
    consent,
    arm(next: DesktopPlan): void {
      plan = next
      // The clock starts at the FIRST arming and is not reset by a re-plan —
      // otherwise a stuck model could re-propose its way around the budget
      // forever, which is precisely the loop this exists to end.
      armedAtMs ??= now()
    },
    elapsedMs(): number | null {
      return armedAtMs === null ? null : now() - armedAtMs
    },
    hasOutrunBudget(): boolean {
      return armedAtMs !== null && now() - armedAtMs >= budgetMs
    },
    isArmed(): boolean {
      return plan !== null
    },
    armedPlan(): DesktopPlan | null {
      // A COPY — the overlay/status readers must never mutate the consented plan.
      if (plan === null) return null
      return {
        goal: plan.goal,
        steps: [...plan.steps],
        apps: plan.apps.map((planApp) => ({ ...planApp })),
      }
    },
    authorizesApp(resolvedAppName: string, required: DesktopAccessTier): boolean {
      if (plan === null || consent === 'display-only') return false
      const resolvedKey = normalizeDesktopAppKey(resolvedAppName)
      if (resolvedKey.length === 0) return false
      return plan.apps.some(
        (planApp) =>
          normalizeDesktopAppKey(planApp.app) === resolvedKey && tierAllows(planApp.tier, required),
      )
    },
  }
}

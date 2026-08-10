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
}

export function createDesktopPlanEnvelope(consent: DesktopPlanConsent): DesktopPlanEnvelope {
  let plan: DesktopPlan | null = null
  return {
    consent,
    arm(next: DesktopPlan): void {
      plan = next
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

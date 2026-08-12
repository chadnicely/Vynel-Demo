import { describe, it, expect } from 'vitest'
import {
  createDesktopPlanEnvelope,
  DESKTOP_TASK_BUDGET_MS,
  type DesktopPlan,
} from './desktop-plan-envelope.js'

const chromePlan: DesktopPlan = {
  goal: 'Open Chrome and search the latest song on YouTube',
  steps: ['Focus Chrome', 'Open youtube.com', 'Search for the latest song'],
  apps: [{ app: 'Google Chrome', tier: 'full' }],
}

describe('createDesktopPlanEnvelope', () => {
  it('starts unarmed and authorizes nothing', () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    expect(envelope.isArmed()).toBe(false)
    expect(envelope.armedPlan()).toBeNull()
    expect(envelope.authorizesApp('Google Chrome', 'read')).toBe(false)
  })

  it('arms with a plan and authorizes its apps up to the stated tier', () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    envelope.arm(chromePlan)
    expect(envelope.isArmed()).toBe(true)
    expect(envelope.armedPlan()).toEqual(chromePlan)
    // 'full' covers every lower tier for the plan's app…
    expect(envelope.authorizesApp('Google Chrome', 'full')).toBe(true)
    expect(envelope.authorizesApp('Google Chrome', 'click')).toBe(true)
    expect(envelope.authorizesApp('Google Chrome', 'read')).toBe(true)
    // …and nothing for an app the plan never named.
    expect(envelope.authorizesApp('Discord', 'read')).toBe(false)
  })

  it('never authorizes above the stated tier', () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    envelope.arm({ ...chromePlan, apps: [{ app: 'Google Chrome', tier: 'click' }] })
    expect(envelope.authorizesApp('Google Chrome', 'click')).toBe(true)
    expect(envelope.authorizesApp('Google Chrome', 'full')).toBe(false)
  })

  it('matches by normalized key, exactly — never fuzzily', () => {
    const envelope = createDesktopPlanEnvelope('standing-consent')
    envelope.arm({ ...chromePlan, apps: [{ app: 'Discord.exe', tier: 'click' }] })
    // Casefold + .exe strip resolve to the SAME app…
    expect(envelope.authorizesApp('discord', 'click')).toBe(true)
    expect(envelope.authorizesApp('Discord', 'click')).toBe(true)
    // …but a substring/superstring is a DIFFERENT app (the card named "Discord",
    // so "Discord Canary" was never approved).
    expect(envelope.authorizesApp('Discord Canary', 'click')).toBe(false)
    expect(envelope.authorizesApp('', 'read')).toBe(false)
  })

  it('display-only consent arms (for narration) but never authorizes', () => {
    const envelope = createDesktopPlanEnvelope('display-only')
    envelope.arm(chromePlan)
    expect(envelope.isArmed()).toBe(true)
    expect(envelope.authorizesApp('Google Chrome', 'read')).toBe(false)
  })

  it('re-arming replaces the plan wholesale', () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    envelope.arm(chromePlan)
    envelope.arm({
      goal: 'Reply in Discord',
      steps: ['Open the channel', 'Type the reply', 'Send it'],
      apps: [{ app: 'Discord', tier: 'full' }],
    })
    expect(envelope.authorizesApp('Discord', 'full')).toBe(true)
    // The earlier plan's authority is GONE — one plan at a time.
    expect(envelope.authorizesApp('Google Chrome', 'read')).toBe(false)
  })
})

// The watchdog (Kafi, 2026-08-11). Nothing bounds a turn today, so a model
// clicking a button that never responds runs until a human notices — fine when
// someone is watching, which is exactly not the case for a spawned session
// working while the user is away.
describe('the desktop task budget', () => {
  function clockedEnvelope(budgetMs: number) {
    let current = 1_000
    const envelope = createDesktopPlanEnvelope('standing-consent', {
      budgetMs,
      now: () => current,
    })
    return { envelope, advance: (ms: number) => (current += ms) }
  }
  const plan = { goal: 'g', steps: ['s'], apps: [{ app: 'X', tier: 'full' as const }] }

  it('is not running before a plan is armed', () => {
    const { envelope } = clockedEnvelope(1_000)
    expect(envelope.elapsedMs()).toBeNull()
    expect(envelope.hasOutrunBudget()).toBe(false)
  })

  it('lets an ordinary task run well inside the budget', () => {
    const { envelope, advance } = clockedEnvelope(60_000)
    envelope.arm(plan)
    advance(20_000)
    expect(envelope.hasOutrunBudget()).toBe(false)
    expect(envelope.elapsedMs()).toBe(20_000)
  })

  it('stops the task once the budget is spent', () => {
    const { envelope, advance } = clockedEnvelope(10_000)
    envelope.arm(plan)
    advance(10_000)
    expect(envelope.hasOutrunBudget()).toBe(true)
  })

  // THE one that matters. A stuck model re-proposing its plan would otherwise
  // buy itself unlimited time — which is the exact loop the budget exists to end.
  it('does NOT reset the clock when the plan is re-armed', () => {
    const { envelope, advance } = clockedEnvelope(10_000)
    envelope.arm(plan)
    advance(9_000)
    envelope.arm({ ...plan, goal: 'trying again' })
    expect(envelope.elapsedMs()).toBe(9_000)
    advance(1_000)
    expect(envelope.hasOutrunBudget()).toBe(true)
  })
})

// The two budgets used to be identical, which LOOKED deliberate and was the bug:
// the delegation budget runs from the job being CLAIMED, this one from the plan
// being FIRST ARMED — always later — so at 10 minutes each the delegation
// deadline always won and this watchdog could never fire on a delegated turn,
// the exact unattended case it exists for.
describe('the desktop watchdog against the delegation budget', () => {
  // Mirrored, not imported: desktop-control must not depend on @vynel/session.
  // If that constant moves, this test is the tripwire.
  const DELEGATION_RUN_BUDGET_MS = 10 * 60 * 1000

  it('leaves room for the delegation clock, which starts EARLIER', () => {
    expect(DESKTOP_TASK_BUDGET_MS).toBeLessThan(DELEGATION_RUN_BUDGET_MS)
  })

  it('leaves enough headroom to REPORT, not just to die quietly', () => {
    // The timeout message tells the model to look at the screen and tell the
    // user where it got to. That needs time after the watchdog fires.
    const headroom = DELEGATION_RUN_BUDGET_MS - DESKTOP_TASK_BUDGET_MS
    expect(headroom).toBeGreaterThanOrEqual(3 * 60 * 1000)
  })

  it('still allows a long real task to finish', () => {
    // Several wait_for calls at the 120s cap plus the acting between them.
    expect(DESKTOP_TASK_BUDGET_MS).toBeGreaterThanOrEqual(5 * 60 * 1000)
  })
})

// The durable record's seam. It lives on the envelope because that is the one
// thing every act tool already shares — so a seventh tool added later cannot
// quietly go unrecorded.
describe('recordAct', () => {
  const plan = { goal: 'check the containers', steps: ['open it'], apps: [] }

  it('stamps every act with the plan goal, so a row reads on its own', () => {
    const written: Array<{ goal: string | null; detail: string }> = []
    const envelope = createDesktopPlanEnvelope('approval-card', {
      write: (record) => written.push(record),
    })
    envelope.arm(plan)
    envelope.recordAct({ tool: 'launch_app', detail: 'launched', outcome: 'ok' })
    expect(written).toEqual([
      expect.objectContaining({ goal: 'check the containers', detail: 'launched' }),
    ])
  })

  it('records an act that happened BEFORE any plan with a null goal', () => {
    // Should not arise (acting refuses unarmed), but a record that throws or
    // invents a goal would be worse than one that says "no goal".
    const written: Array<{ goal: string | null }> = []
    const envelope = createDesktopPlanEnvelope('approval-card', {
      write: (record) => written.push(record),
    })
    envelope.recordAct({ tool: 'x', detail: 'y', outcome: 'ok' })
    expect(written[0]?.goal).toBeNull()
  })

  it('NEVER lets a failing log break the act it is logging', () => {
    // The act already happened. Throwing here would tell the model it failed
    // when it did not — a worse lie than a missing line.
    const envelope = createDesktopPlanEnvelope('approval-card', {
      write: () => {
        throw new Error('database is gone')
      },
    })
    envelope.arm(plan)
    expect(() => envelope.recordAct({ tool: 'x', detail: 'y', outcome: 'ok' })).not.toThrow()
  })

  it('is a no-op when nothing is wired to write to', () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    expect(() => envelope.recordAct({ tool: 'x', detail: 'y', outcome: 'ok' })).not.toThrow()
  })
})

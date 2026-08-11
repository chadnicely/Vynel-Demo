import { describe, it, expect } from 'vitest'
import { ForbiddenError } from '@vynel/errors'
import { createDesktopPlanEnvelope } from './desktop-plan-envelope.js'
import {
  makePlanGatedAuthorizer,
  planRequiredError,
  PLAN_REQUIRED_MESSAGE,
  TASK_BUDGET_SPENT_MESSAGE,
  unattendedRefusalError,
} from './plan-gated-authorization.js'

const armed = () => {
  const envelope = createDesktopPlanEnvelope('approval-card')
  envelope.arm({
    goal: 'g',
    steps: ['s'],
    apps: [{ app: 'Notepad', tier: 'click' }],
  })
  return envelope
}

describe('planRequiredError', () => {
  it('refuses until the envelope is armed, then stands down', () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    expect(planRequiredError(envelope)).toBe(PLAN_REQUIRED_MESSAGE)
    envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'click' }] })
    expect(planRequiredError(envelope)).toBeNull()
  })
})

describe('makePlanGatedAuthorizer', () => {
  it('lets the armed plan satisfy an act without consulting standing grants', () => {
    let standingCalls = 0
    const authorize = makePlanGatedAuthorizer(armed(), () => {
      standingCalls += 1
      throw new ForbiddenError('no grant')
    })
    expect(() => authorize('Notepad', 'click')).not.toThrow()
    expect(standingCalls).toBe(0)
  })

  it('falls through to standing grants when the plan does not cover the act', () => {
    let standingCalls = 0
    const authorize = makePlanGatedAuthorizer(armed(), () => {
      standingCalls += 1
    })
    // Above the plan's tier AND an unplanned app both defer to the grant gate.
    authorize('Notepad', 'full')
    authorize('Discord', 'read')
    expect(standingCalls).toBe(2)
  })

  it('appends the plan recovery path to a standing denial', () => {
    const authorize = makePlanGatedAuthorizer(armed(), () => {
      throw new ForbiddenError('Desktop access denied for "Discord".')
    })
    expect(() => authorize('Discord', 'full')).toThrowError(
      /Desktop access denied for "Discord"\..*propose_desktop_plan.*"Discord" at tier "full"/s,
    )
  })

  it('rethrows a non-Forbidden failure untouched (never masks a real error)', () => {
    const boom = new Error('adapter exploded')
    const authorize = makePlanGatedAuthorizer(armed(), () => {
      throw boom
    })
    expect(() => authorize('Discord', 'read')).toThrow(boom)
  })

  it('mirrors the bare-authorizer contract when no standing authorizer exists', () => {
    // Test harnesses build act tools without an authorizer; a plan miss must
    // not invent a denial the ungated path would never have raised.
    const authorize = makePlanGatedAuthorizer(armed(), undefined)
    expect(() => authorize('Discord', 'full')).not.toThrow()
  })
})

// The watchdog reaching the tools. Every acting path shares this one pre-flight,
// so the budget has to bite HERE or it bites nowhere.
describe('the task budget in the shared pre-flight', () => {
  const plan = { goal: 'g', steps: ['s'], apps: [{ app: 'X', tier: 'full' as const }] }
  function spent() {
    let current = 0
    const envelope = createDesktopPlanEnvelope('approval-card', {
      budgetMs: 1_000,
      now: () => current,
    })
    envelope.arm(plan)
    current += 1_000
    return envelope
  }

  it('still asks for a plan FIRST when none is armed', () => {
    const envelope = createDesktopPlanEnvelope('approval-card', { budgetMs: 0 })
    expect(planRequiredError(envelope)).toBe(PLAN_REQUIRED_MESSAGE)
  })

  it('stops an armed task once its budget is spent', () => {
    expect(planRequiredError(spent())).toBe(TASK_BUDGET_SPENT_MESSAGE)
  })

  it('tells the model to REPORT rather than retry — retrying is what got it here', () => {
    const message = planRequiredError(spent()) ?? ''
    expect(message).toMatch(/do NOT simply retry/i)
    expect(message).toMatch(/does not reset/i)
    expect(message).toMatch(/tell the user/i)
  })

  // The clipboard is app-less, so it goes through the unattended gate instead —
  // which must still inherit the budget rather than routing around it.
  it('the clipboard gate inherits the budget too', () => {
    expect(unattendedRefusalError(spent())).toBe(TASK_BUDGET_SPENT_MESSAGE)
  })

  it('lets an armed task inside its budget through', () => {
    const envelope = createDesktopPlanEnvelope('approval-card', { budgetMs: 60_000 })
    envelope.arm(plan)
    expect(planRequiredError(envelope)).toBeNull()
    expect(unattendedRefusalError(envelope)).toBeNull()
  })
})

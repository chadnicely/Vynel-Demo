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
  it('lets the armed plan satisfy an act', () => {
    expect(() => makePlanGatedAuthorizer(armed())('Notepad', 'click')).not.toThrow()
  })

  // The inversion. This USED to fall through to a standing per-app grant, and —
  // the trap — ALLOWED when no standing authorizer was supplied, which is how
  // test harnesses built ungated tools. With grants retired, that default would
  // have made every act permissive, so a plan miss now denies.
  it('DENIES an app the plan does not name', () => {
    expect(() => makePlanGatedAuthorizer(armed())('Discord', 'click')).toThrow(ForbiddenError)
  })

  it('DENIES a tier above what the plan asked for', () => {
    // The plan names Notepad at "click"; typing into it is "full".
    expect(() => makePlanGatedAuthorizer(armed())('Notepad', 'full')).toThrow(ForbiddenError)
  })

  it('names the ONE recovery that exists now', () => {
    const denial = makePlanGatedAuthorizer(armed())
    let message = ''
    try {
      denial('Discord', 'full')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/propose_desktop_plan/)
    expect(message).toMatch(/"Discord" at tier "full"/)
    // The second door is gone; the denial must not send the model looking for it.
    expect(message).not.toMatch(/request_desktop_access/)
  })

  it('says WHY when the app could not be identified, rather than blaming the plan', () => {
    // set_window_bounds / set_window_state pass '' for an unresolvable hosted
    // window; "your plan does not cover ''" would be a nonsense recovery.
    let message = ''
    try {
      makePlanGatedAuthorizer(armed())('', 'click')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/could not be identified/i)
    expect(message).not.toMatch(/propose_desktop_plan/)
  })

  it('tells an UNATTENDED turn that it has no authority at all', () => {
    // display-only was the conservative floor whose only authority WAS a
    // standing grant, so with grants gone it can no longer act. Say that
    // plainly instead of suggesting a plan change that would not help.
    const envelope = createDesktopPlanEnvelope('display-only')
    envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'click' }] })
    let message = ''
    try {
      makePlanGatedAuthorizer(envelope)('Notepad', 'click')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/unattended/i)
    expect(message).not.toMatch(/propose_desktop_plan/)
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

import { describe, it, expect } from 'vitest'
import { ForbiddenError } from '@vynel/errors'
import { createDesktopPlanEnvelope } from './desktop-plan-envelope.js'
import {
  makePlanGatedAuthorizer,
  planRequiredError,
  PLAN_REQUIRED_MESSAGE,
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

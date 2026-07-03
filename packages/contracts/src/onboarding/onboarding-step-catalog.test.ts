import { describe, it, expect } from 'vitest'
import {
  ONBOARDING_STEP_CATALOG,
  findOnboardingStepByKind,
  getNextOnboardingStep,
} from './onboarding-step-catalog.js'

describe('ONBOARDING_STEP_CATALOG', () => {
  it('has all seven steps in order 1..7', () => {
    expect(ONBOARDING_STEP_CATALOG).toHaveLength(7)
    expect(ONBOARDING_STEP_CATALOG.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('marks only the two optional steps skippable', () => {
    const skippable = ONBOARDING_STEP_CATALOG.filter((s) => s.isSkippable).map((s) => s.stepKind)
    expect(skippable).toEqual(['optional-channel', 'optional-schedule'])
  })
})

describe('findOnboardingStepByKind', () => {
  it('returns the entry for a known kind', () => {
    expect(findOnboardingStepByKind('profile')?.order).toBe(2)
  })

  it('returns null for an unknown kind', () => {
    // @ts-expect-error — exercising the null branch with a non-kind value
    expect(findOnboardingStepByKind('nope')).toBeNull()
  })
})

describe('getNextOnboardingStep', () => {
  it('advances to the next step', () => {
    expect(getNextOnboardingStep('welcome')).toBe('profile')
    expect(getNextOnboardingStep('optional-channel')).toBe('optional-schedule')
  })

  it('returns null after the last step', () => {
    expect(getNextOnboardingStep('optional-schedule')).toBeNull()
  })
})

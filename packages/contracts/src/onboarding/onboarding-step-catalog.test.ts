import { describe, it, expect } from 'vitest'
import {
  ONBOARDING_STEP_CATALOG,
  findOnboardingStepByKind,
  getNextOnboardingStep,
} from './onboarding-step-catalog.js'

describe('ONBOARDING_STEP_CATALOG', () => {
  it('has the two steps in order 1..2 — welcome, then the name', () => {
    expect(ONBOARDING_STEP_CATALOG).toHaveLength(2)
    expect(ONBOARDING_STEP_CATALOG.map((s) => s.stepKind)).toEqual(['welcome', 'profile'])
    expect(ONBOARDING_STEP_CATALOG.map((s) => s.order)).toEqual([1, 2])
  })

  it('marks nothing skippable — both steps are the whole setup', () => {
    expect(ONBOARDING_STEP_CATALOG.filter((s) => s.isSkippable)).toEqual([])
  })
})

describe('findOnboardingStepByKind', () => {
  it('returns the entry for a known kind', () => {
    expect(findOnboardingStepByKind('profile')?.order).toBe(2)
  })

  it('returns null for an unknown kind — including a RETIRED one from an old row', () => {
    expect(findOnboardingStepByKind('nope')).toBeNull()
    // The pre-2026-08-24 seven-step flow's kinds must read as unknown so a
    // parked run self-heals at start instead of resuming a dead screen.
    expect(findOnboardingStepByKind('identity-seed')).toBeNull()
    expect(findOnboardingStepByKind('optional-schedule')).toBeNull()
  })
})

describe('getNextOnboardingStep', () => {
  it('advances welcome to profile', () => {
    expect(getNextOnboardingStep('welcome')).toBe('profile')
  })

  it('returns null after the last step — profile completes the run', () => {
    expect(getNextOnboardingStep('profile')).toBeNull()
  })
})

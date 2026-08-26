import { describe, it, expect } from 'vitest'
import {
  ONBOARDING_STEP_CATALOG,
  findOnboardingStepByKind,
  getNextOnboardingStep,
} from './onboarding-step-catalog.js'

describe('ONBOARDING_STEP_CATALOG', () => {
  it('is the five-screen first launch, in order 1..5', () => {
    expect(ONBOARDING_STEP_CATALOG).toHaveLength(5)
    expect(ONBOARDING_STEP_CATALOG.map((s) => s.order)).toEqual([1, 2, 3, 4, 5])
    expect(ONBOARDING_STEP_CATALOG.map((s) => s.stepKind)).toEqual([
      'welcome',
      'profile',
      'identity-seed',
      'connect-brain',
      'github-backup',
    ])
  })

  it('only the GitHub copy is skippable — nothing builds without a brain', () => {
    const skippable = ONBOARDING_STEP_CATALOG.filter((s) => s.isSkippable).map((s) => s.stepKind)
    expect(skippable).toEqual(['github-backup'])
  })

  it('names Vynel in its labels, never the model behind it', () => {
    expect(findOnboardingStepByKind('identity-seed')?.displayLabel).toBe('Help Vynel know you')
    // The brain step legitimately names providers on screen; the step LABELS
    // stay in Vynel's own voice.
    const wording = ONBOARDING_STEP_CATALOG.map(
      (s) => `${s.displayLabel} ${s.oneLineDescription}`,
    ).join(' ')
    expect(wording).not.toContain('Claude')
  })
})

describe('findOnboardingStepByKind', () => {
  it('returns the entry for a known kind', () => {
    expect(findOnboardingStepByKind('profile')?.order).toBe(2)
  })

  it('returns null for an unknown kind — including a RETIRED one from an old row', () => {
    expect(findOnboardingStepByKind('nope')).toBeNull()
    // The seven-step flow's retired kinds must read as unknown so a parked run
    // self-heals at start instead of resuming a dead screen.
    expect(findOnboardingStepByKind('name-workspace')).toBeNull()
    expect(findOnboardingStepByKind('optional-schedule')).toBeNull()
  })
})

describe('getNextOnboardingStep', () => {
  it('advances through the five screens', () => {
    expect(getNextOnboardingStep('welcome')).toBe('profile')
    expect(getNextOnboardingStep('profile')).toBe('identity-seed')
    expect(getNextOnboardingStep('identity-seed')).toBe('connect-brain')
    expect(getNextOnboardingStep('connect-brain')).toBe('github-backup')
  })

  it('returns null after the last step — the GitHub copy ends the run', () => {
    expect(getNextOnboardingStep('github-backup')).toBeNull()
  })
})

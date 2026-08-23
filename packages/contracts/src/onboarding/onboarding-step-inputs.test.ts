import { describe, it, expect } from 'vitest'
import { WelcomeStepInputSchema, ProfileStepInputSchema } from './onboarding-step-inputs.js'

describe('WelcomeStepInputSchema', () => {
  it('accepts only an explicit acknowledgement', () => {
    expect(WelcomeStepInputSchema.safeParse({ acknowledged: true }).success).toBe(true)
    expect(WelcomeStepInputSchema.safeParse({ acknowledged: false }).success).toBe(false)
    expect(WelcomeStepInputSchema.safeParse({}).success).toBe(false)
  })
})

describe('ProfileStepInputSchema', () => {
  it('accepts displayName / locale / timezone', () => {
    const parsed = ProfileStepInputSchema.safeParse({
      displayName: 'Sam Lee',
      locale: 'en-US',
      timezone: 'America/Los_Angeles',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an empty displayName', () => {
    expect(
      ProfileStepInputSchema.safeParse({ displayName: '', locale: 'en-US', timezone: 'UTC' }).success,
    ).toBe(false)
  })
})

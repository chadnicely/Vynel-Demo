import { describe, it, expect } from 'vitest'
import {
  ProfileStepInputSchema,
  OptionalChannelStepInputSchema,
  OptionalScheduleStepInputSchema,
} from './onboarding-step-inputs.js'

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

describe('OptionalChannelStepInputSchema', () => {
  it('accepts skipped and a telegram connect; rejects discord (Phase 1)', () => {
    expect(OptionalChannelStepInputSchema.safeParse({ kind: 'skipped' }).success).toBe(true)
    expect(
      OptionalChannelStepInputSchema.safeParse({
        kind: 'connect',
        channelKind: 'telegram',
        displayName: 'My bot',
        botCredentials: { botToken: 'x' },
      }).success,
    ).toBe(true)
    expect(
      OptionalChannelStepInputSchema.safeParse({
        kind: 'connect',
        channelKind: 'discord',
        displayName: 'My bot',
        botCredentials: { botToken: 'x' },
      }).success,
    ).toBe(false)
  })
})

describe('OptionalScheduleStepInputSchema', () => {
  it('requires a fireHour in 0..23 for create-morning-briefing', () => {
    expect(
      OptionalScheduleStepInputSchema.safeParse({ kind: 'create-morning-briefing', fireHour: 8 })
        .success,
    ).toBe(true)
    expect(
      OptionalScheduleStepInputSchema.safeParse({ kind: 'create-morning-briefing', fireHour: 24 })
        .success,
    ).toBe(false)
  })
})

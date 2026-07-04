import { describe, it, expect } from 'vitest'
import { isOneTimeSchedule } from './one-time.js'

describe('isOneTimeSchedule', () => {
  it('is true only for scheduleKind "one-time"', () => {
    expect(isOneTimeSchedule({ scheduleKind: 'one-time' })).toBe(true)
  })

  it('is false for a recurring schedule', () => {
    expect(isOneTimeSchedule({ scheduleKind: 'recurring' })).toBe(false)
  })
})

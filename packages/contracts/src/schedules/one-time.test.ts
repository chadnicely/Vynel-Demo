import { describe, it, expect } from 'vitest'
import { ONE_TIME_CRON_SENTINEL, isOneTimeSchedule } from './one-time.js'

describe('isOneTimeSchedule', () => {
  it('is true only for the sentinel cron', () => {
    expect(isOneTimeSchedule({ cronExpression: ONE_TIME_CRON_SENTINEL })).toBe(true)
  })

  it('is false for a real cron expression or an empty string', () => {
    expect(isOneTimeSchedule({ cronExpression: '0 8 * * *' })).toBe(false)
    expect(isOneTimeSchedule({ cronExpression: '0 9 * * MON' })).toBe(false)
    expect(isOneTimeSchedule({ cronExpression: '' })).toBe(false)
  })
})

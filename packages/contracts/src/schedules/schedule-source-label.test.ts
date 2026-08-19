import { describe, expect, it } from 'vitest'
import { scheduleSourceLabel } from './schedule-source-label.js'

describe('scheduleSourceLabel', () => {
  it('renders the system-notice convention: "Schedule · <name>"', () => {
    expect(scheduleSourceLabel('Tea')).toBe('Schedule · Tea')
    expect(scheduleSourceLabel('Morning brief')).toBe('Schedule · Morning brief')
  })
})

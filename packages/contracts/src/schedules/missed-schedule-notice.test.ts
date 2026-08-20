import { describe, expect, it } from 'vitest'
import { composeMissedScheduleNotice } from './missed-schedule-notice.js'

describe('composeMissedScheduleNotice', () => {
  it('names the schedule, the slot that passed and the next armed one', () => {
    expect(
      composeMissedScheduleNotice({
        scheduleDisplayName: 'Tea',
        missedAtLocal: 'Aug 21, 2026, 5:00 PM',
        nextFireAtLocal: 'Aug 22, 2026, 5:00 PM',
      }),
    ).toBe(
      '📅 Schedule · Tea missed its Aug 21, 2026, 5:00 PM run (Vynel was not running); ' +
        'next run Aug 22, 2026, 5:00 PM',
    )
  })

  it('says "none" for a disarmed one-time schedule', () => {
    expect(
      composeMissedScheduleNotice({
        scheduleDisplayName: 'Dentist',
        missedAtLocal: 'Aug 21, 2026, 9:00 AM',
        nextFireAtLocal: null,
      }),
    ).toContain('next run none')
  })
})

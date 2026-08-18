import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isSystemReporterSessionId } from './system-reporter.js'

describe('isSystemReporterSessionId', () => {
  // The prefix list is LOAD-BEARING (system marker/steer + the quiet UI row
  // key off it) — pin all three producers so a renamed enqueue can't silently
  // change how its deliveries read.
  it('recognizes every system producer prefix', () => {
    expect(isSystemReporterSessionId(`task:${randomUUID()}`)).toBe(true)
    expect(isSystemReporterSessionId(`schedule:${randomUUID()}`)).toBe(true)
    expect(isSystemReporterSessionId(`monitor:${randomUUID()}`)).toBe(true)
  })

  it('never matches a real session id or the note reply-address convention', () => {
    expect(isSystemReporterSessionId(randomUUID())).toBe(false)
    expect(isSystemReporterSessionId(`session:${randomUUID()}`)).toBe(false)
    expect(isSystemReporterSessionId('')).toBe(false)
  })
})

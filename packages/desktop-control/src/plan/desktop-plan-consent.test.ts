import { describe, it, expect } from 'vitest'
import { deriveDesktopPlanConsent } from './desktop-plan-consent.js'

describe('deriveDesktopPlanConsent', () => {
  it('maps ask to approval-card (the plan card IS the consent)', () => {
    expect(deriveDesktopPlanConsent('ask')).toBe('approval-card')
  })

  it('maps the user\'s auto/bypass to standing-consent', () => {
    expect(deriveDesktopPlanConsent('auto')).toBe('standing-consent')
    expect(deriveDesktopPlanConsent('bypass')).toBe('standing-consent')
  })

  it('falls to display-only for absent and unruled modes (no unattended self-grant)', () => {
    // Absent mode = the unattended `bypass-with-behavior-gate` default
    // (channels, schedules) — an armed plan must narrate without authorizing.
    expect(deriveDesktopPlanConsent(undefined)).toBe('display-only')
    expect(deriveDesktopPlanConsent('bypass-with-behavior-gate')).toBe('display-only')
    expect(deriveDesktopPlanConsent('plan-only')).toBe('display-only')
    expect(deriveDesktopPlanConsent('some-future-mode')).toBe('display-only')
  })
})

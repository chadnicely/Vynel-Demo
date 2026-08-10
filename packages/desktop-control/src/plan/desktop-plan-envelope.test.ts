import { describe, it, expect } from 'vitest'
import { createDesktopPlanEnvelope, type DesktopPlan } from './desktop-plan-envelope.js'

const chromePlan: DesktopPlan = {
  goal: 'Open Chrome and search the latest song on YouTube',
  steps: ['Focus Chrome', 'Open youtube.com', 'Search for the latest song'],
  apps: [{ app: 'Google Chrome', tier: 'full' }],
}

describe('createDesktopPlanEnvelope', () => {
  it('starts unarmed and authorizes nothing', () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    expect(envelope.isArmed()).toBe(false)
    expect(envelope.armedPlan()).toBeNull()
    expect(envelope.authorizesApp('Google Chrome', 'read')).toBe(false)
  })

  it('arms with a plan and authorizes its apps up to the stated tier', () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    envelope.arm(chromePlan)
    expect(envelope.isArmed()).toBe(true)
    expect(envelope.armedPlan()).toEqual(chromePlan)
    // 'full' covers every lower tier for the plan's app…
    expect(envelope.authorizesApp('Google Chrome', 'full')).toBe(true)
    expect(envelope.authorizesApp('Google Chrome', 'click')).toBe(true)
    expect(envelope.authorizesApp('Google Chrome', 'read')).toBe(true)
    // …and nothing for an app the plan never named.
    expect(envelope.authorizesApp('Discord', 'read')).toBe(false)
  })

  it('never authorizes above the stated tier', () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    envelope.arm({ ...chromePlan, apps: [{ app: 'Google Chrome', tier: 'click' }] })
    expect(envelope.authorizesApp('Google Chrome', 'click')).toBe(true)
    expect(envelope.authorizesApp('Google Chrome', 'full')).toBe(false)
  })

  it('matches by normalized key, exactly — never fuzzily', () => {
    const envelope = createDesktopPlanEnvelope('standing-consent')
    envelope.arm({ ...chromePlan, apps: [{ app: 'Discord.exe', tier: 'click' }] })
    // Casefold + .exe strip resolve to the SAME app…
    expect(envelope.authorizesApp('discord', 'click')).toBe(true)
    expect(envelope.authorizesApp('Discord', 'click')).toBe(true)
    // …but a substring/superstring is a DIFFERENT app (the card named "Discord",
    // so "Discord Canary" was never approved).
    expect(envelope.authorizesApp('Discord Canary', 'click')).toBe(false)
    expect(envelope.authorizesApp('', 'read')).toBe(false)
  })

  it('display-only consent arms (for narration) but never authorizes', () => {
    const envelope = createDesktopPlanEnvelope('display-only')
    envelope.arm(chromePlan)
    expect(envelope.isArmed()).toBe(true)
    expect(envelope.authorizesApp('Google Chrome', 'read')).toBe(false)
  })

  it('re-arming replaces the plan wholesale', () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    envelope.arm(chromePlan)
    envelope.arm({
      goal: 'Reply in Discord',
      steps: ['Open the channel', 'Type the reply', 'Send it'],
      apps: [{ app: 'Discord', tier: 'full' }],
    })
    expect(envelope.authorizesApp('Discord', 'full')).toBe(true)
    // The earlier plan's authority is GONE — one plan at a time.
    expect(envelope.authorizesApp('Google Chrome', 'read')).toBe(false)
  })
})

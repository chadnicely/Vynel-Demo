import { describe, it, expect } from 'vitest'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import {
  makeProposeDesktopPlanTool,
  parsePlanApps,
  parsePlanSteps,
} from './propose-desktop-plan-tool.js'

type BuiltTool = {
  name: string
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean }
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

const validArgs = {
  goal: 'Open Chrome and search the latest song on YouTube',
  steps: ['Focus Chrome', 'Open youtube.com', 'Search'],
  apps: [{ app: 'Google Chrome', tier: 'full' }],
}

describe('parsePlanSteps / parsePlanApps', () => {
  it('accept well-formed input and trim entries', () => {
    expect(parsePlanSteps(['  a  ', 'b'])).toEqual(['a', 'b'])
    expect(parsePlanApps([{ app: ' Chrome ', tier: 'click' }])).toEqual([
      { app: 'Chrome', tier: 'click' },
    ])
  })

  it('reject empties, blanks, bad tiers, and oversize lists', () => {
    expect(parsePlanSteps([])).toBeNull()
    expect(parsePlanSteps(['ok', '  '])).toBeNull()
    expect(parsePlanSteps(Array.from({ length: 21 }, () => 's'))).toBeNull()
    expect(parsePlanApps([])).toBeNull()
    expect(parsePlanApps([{ app: 'Chrome', tier: 'admin' }])).toBeNull()
    expect(parsePlanApps([{ tier: 'click' }])).toBeNull()
    expect(parsePlanApps(Array.from({ length: 11 }, () => ({ app: 'a', tier: 'read' })))).toBeNull()
  })
})

describe('makeProposeDesktopPlanTool', () => {
  it('is named propose_desktop_plan and marked destructive (a consent moment, never a safe read)', () => {
    const built = makeProposeDesktopPlanTool(createDesktopPlanEnvelope('approval-card')) as BuiltTool
    expect(built.name).toBe('propose_desktop_plan')
    expect(built.annotations?.destructiveHint).toBe(true)
    expect(built.annotations?.readOnlyHint).not.toBe(true)
  })

  it('arms the envelope with the stated plan', async () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    const built = makeProposeDesktopPlanTool(envelope) as BuiltTool
    const result = await built.handler(validArgs)
    expect(result.isError).not.toBe(true)
    expect(envelope.armedPlan()).toEqual(validArgs)
    expect(envelope.authorizesApp('Google Chrome', 'full')).toBe(true)
  })

  it('refuses invalid input and leaves the envelope unarmed', async () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    const built = makeProposeDesktopPlanTool(envelope) as BuiltTool
    const result = await built.handler({ ...validArgs, apps: [] })
    expect(result.isError).toBe(true)
    expect(envelope.isArmed()).toBe(false)
  })

  it('tells the model what the arming means, per consent mode', async () => {
    const carded = createDesktopPlanEnvelope('approval-card')
    const cardedText =
      (await (makeProposeDesktopPlanTool(carded) as BuiltTool).handler(validArgs)).content[0]
        ?.text ?? ''
    expect(cardedText).toContain('user approved this plan')
    expect(cardedText).toContain('"Google Chrome" (full)')

    const standing = createDesktopPlanEnvelope('standing-consent')
    const standingText =
      (await (makeProposeDesktopPlanTool(standing) as BuiltTool).handler(validArgs)).content[0]
        ?.text ?? ''
    expect(standingText).toContain('standing consent')

    // Unattended: armed for narration, but the text must NOT claim authorization.
    const displayOnly = createDesktopPlanEnvelope('display-only')
    const displayText =
      (await (makeProposeDesktopPlanTool(displayOnly) as BuiltTool).handler(validArgs)).content[0]
        ?.text ?? ''
    // test: correct expectation — was "cannot authorize new apps" + a pointer
    // to `request_desktop_access`. With standing grants retired, display-only
    // authorizes NOTHING rather than "nothing new", and the tool it named is
    // gone — so the old text sent an unattended turn chasing a door that no
    // longer exists instead of reporting back to the user.
    expect(displayText).toMatch(/NO authority to act/)
    expect(displayText).not.toContain('request_desktop_access')
    expect(displayText).toMatch(/tell the user/i)
    expect(displayOnly.isArmed()).toBe(true)
    expect(displayOnly.authorizesApp('Google Chrome', 'read')).toBe(false)
  })

  it('re-proposing replaces the plan (scope changes re-consent as one unit)', async () => {
    const envelope = createDesktopPlanEnvelope('approval-card')
    const built = makeProposeDesktopPlanTool(envelope) as BuiltTool
    await built.handler(validArgs)
    await built.handler({
      goal: 'Reply in Discord',
      steps: ['Open the channel', 'Send the reply'],
      apps: [{ app: 'Discord', tier: 'full' }],
    })
    expect(envelope.authorizesApp('Discord', 'full')).toBe(true)
    expect(envelope.authorizesApp('Google Chrome', 'read')).toBe(false)
  })
})

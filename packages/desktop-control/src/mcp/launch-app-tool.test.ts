import { describe, it, expect } from 'vitest'
import { ForbiddenError } from '@vynel/errors'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { PLAN_REQUIRED_MESSAGE } from '../plan/plan-gated-authorization.js'
import { makeLaunchAppTool } from './launch-app-tool.js'
import type { InstalledApp } from '../apps/installed-apps.js'

type BuiltTool = {
  name: string
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean }
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

const INSTALLED: InstalledApp[] = [
  { name: 'Google Chrome', appId: 'chrome-id' },
  { name: 'Chrome Canary', appId: 'canary-id' },
  { name: 'Notepad', appId: 'notepad-id' },
]

function armedEnvelope(app = 'Google Chrome', tier: 'read' | 'click' | 'full' = 'click') {
  const envelope = createDesktopPlanEnvelope('approval-card')
  envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app, tier }] })
  return envelope
}

function buildTool(
  envelope = armedEnvelope(),
  options: {
    launched?: string[]
    authorize?: (app: string, tier: string) => void
    /** The name the WINDOW reports — defaults to the requested name. */
    appearsAs?: string
  } = {},
) {
  const launched = options.launched ?? []
  const tool = makeLaunchAppTool(
    envelope,
    options.authorize as never,
    {
      listApps: async () => INSTALLED,
      launch: async (app) => {
        launched.push(app.name)
        return { kind: 'launched', appName: options.appearsAs ?? app.name }
      },
    },
  ) as BuiltTool
  return { tool, launched }
}

describe('makeLaunchAppTool', () => {
  it('is named launch_app and marked DESTRUCTIVE (starting a program is an action)', () => {
    const { tool } = buildTool()
    expect(tool.name).toBe('launch_app')
    expect(tool.annotations?.destructiveHint).toBe(true)
    expect(tool.annotations?.readOnlyHint).not.toBe(true)
  })

  it('refuses without an armed plan, launching nothing', async () => {
    const { tool, launched } = buildTool(createDesktopPlanEnvelope('approval-card'))
    const result = await tool.handler({ app: 'Google Chrome' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe(PLAN_REQUIRED_MESSAGE)
    expect(launched).toEqual([])
  })

  it('launches an app the approved plan names', async () => {
    const { tool, launched } = buildTool()
    const result = await tool.handler({ app: 'Google Chrome' })
    expect(result.isError).not.toBe(true)
    expect(launched).toEqual(['Google Chrome'])
    expect(result.content[0]?.text).toContain('is open')
  })

  it('calls out a window that opens under a DIFFERENT name than was authorized', async () => {
    // Enforcement runs against the window's own name, so a Start-menu name that
    // drifts ("Firefox Developer Edition" → "Firefox") leaves the plan entry
    // and the grant covering nothing. Saying it here beats a confusing denial
    // on the first act — and it is the one moment we can know.
    const { tool } = buildTool(armedEnvelope(), { appearsAs: 'Chrome' })
    const result = await tool.handler({ app: 'Google Chrome' })
    expect(result.isError).not.toBe(true)
    const text = result.content[0]?.text ?? ''
    expect(text).toContain('reports as "Chrome"')
    expect(text).toContain('does NOT cover it')
    expect(text.toLowerCase()).toContain('propose an updated plan')
  })

  it('stays quiet when the window name matches (no false alarm)', async () => {
    const { tool } = buildTool()
    const text = (await tool.handler({ app: 'Google Chrome' })).content[0]?.text ?? ''
    expect(text).toContain('is open')
    expect(text).not.toContain('does NOT cover it')
  })

  it('treats a case/.exe-only difference as the SAME app, not drift', async () => {
    // normalizeDesktopAppKey is the grant key, so "chrome.exe" vs "Chrome"
    // already resolves to one grant — warning there would be noise.
    const { tool } = buildTool(armedEnvelope('Notepad'), { appearsAs: 'notepad.exe' })
    const text = (await tool.handler({ app: 'Notepad' })).content[0]?.text ?? ''
    expect(text).not.toContain('does NOT cover it')
  })

  it('requires the CLICK tier — "look only" never starts programs', async () => {
    // The read tier is a promise to observe and not touch; starting a program
    // is touching. The standing authorizer is what denies it here.
    const { tool, launched } = buildTool(armedEnvelope('Google Chrome', 'read'), {
      authorize: (app, tier) => {
        throw new ForbiddenError(`denied ${app} at ${tier}`)
      },
    })
    const result = await tool.handler({ app: 'Google Chrome' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('denied Google Chrome at click')
    expect(launched).toEqual([])
  })

  it('refuses an app the plan never named, before launching', async () => {
    const { tool, launched } = buildTool(armedEnvelope('Notepad'), {
      authorize: () => {
        throw new ForbiddenError('Desktop access denied for "Google Chrome".')
      },
    })
    const result = await tool.handler({ app: 'Google Chrome' })
    expect(result.isError).toBe(true)
    expect(launched).toEqual([])
  })

  it('never guesses between ambiguous matches', async () => {
    // Launching the wrong program is a visible side effect the user has to
    // undo — same exact-name rule as the grant door.
    const { tool, launched } = buildTool()
    const result = await tool.handler({ app: 'Chrome' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('matches 2 installed apps')
    expect(launched).toEqual([])
  })

  it('takes an EXACT name even when it is a prefix of another app', async () => {
    const envelope = armedEnvelope('Chrome Canary')
    const { tool, launched } = buildTool(envelope)
    await tool.handler({ app: 'Chrome Canary' })
    expect(launched).toEqual(['Chrome Canary'])
  })

  it('reports an unknown app with the recovery path', async () => {
    const { tool } = buildTool()
    const result = await tool.handler({ app: 'Photoshop' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('list_installed_apps')
  })

  it('requires a non-empty app name', async () => {
    const { tool } = buildTool()
    const result = await tool.handler({ app: '   ' })
    expect(result.isError).toBe(true)
  })
})

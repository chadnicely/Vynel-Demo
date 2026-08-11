import { describe, it, expect } from 'vitest'
import { ForbiddenError } from '@vynel/errors'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { PLAN_REQUIRED_MESSAGE } from '../plan/plan-gated-authorization.js'
import { makeSetWindowStateTool } from './set-window-state-tool.js'
import type { WindowState } from '../a11y/window-state.js'

type BuiltTool = {
  name: string
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean }
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

const armed = () => {
  const envelope = createDesktopPlanEnvelope('standing-consent')
  envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'click' }] })
  return envelope
}

function build(
  envelope = armed(),
  overrides: {
    findPid?: (query: string) => Promise<number | null>
    apply?: (pid: number, state: WindowState) => Promise<boolean>
    authorize?: (appName: string, required: string) => void
  } = {},
) {
  const applied: Array<{ pid: number; state: WindowState }> = []
  const tool = makeSetWindowStateTool(
    envelope,
    overrides.authorize as never,
    {
      findPid: overrides.findPid ?? (async () => 42),
      // Injected so these tests never load the capture binary — the default
      // identity lookup reaches node-screenshots (the request_desktop_access
      // precedent).
      appNameByPid: () => 'Notepad',
      apply:
        overrides.apply ??
        (async (pid: number, state: WindowState) => {
          applied.push({ pid, state })
          return true
        }),
    },
  ) as BuiltTool
  return { tool, applied }
}

describe('makeSetWindowStateTool', () => {
  it('is named set_window_state and marked destructive (it changes the screen)', () => {
    const { tool } = build()
    expect(tool.name).toBe('set_window_state')
    expect(tool.annotations?.destructiveHint).toBe(true)
    expect(tool.annotations?.readOnlyHint).not.toBe(true)
  })

  it('refuses without an armed plan — same gate as the act tools', async () => {
    const { tool, applied } = build(createDesktopPlanEnvelope('standing-consent'))
    const result = await tool.handler({ app: 'Notepad', state: 'maximized' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe(PLAN_REQUIRED_MESSAGE)
    expect(applied).toEqual([])
  })

  it('applies each state to the resolved window', async () => {
    for (const state of ['maximized', 'minimized', 'restored'] as WindowState[]) {
      const { tool, applied } = build()
      const result = await tool.handler({ app: 'Notepad', state })
      expect(result.isError).not.toBe(true)
      expect(applied).toEqual([{ pid: 42, state }])
      expect(result.content[0]?.text).toContain(state)
    }
  })

  it('rejects a missing or invalid state without touching the window', async () => {
    const { tool, applied } = build()
    expect((await tool.handler({ app: 'Notepad', state: 'fullscreen' })).isError).toBe(true)
    expect((await tool.handler({ app: '  ', state: 'maximized' })).isError).toBe(true)
    expect(applied).toEqual([])
  })

  it('reports a FAILED arrange honestly instead of claiming success', async () => {
    // The window may have no reachable main window, or PowerShell may fail —
    // saying "maximized" anyway would have the model plan its next step on a
    // fiction (and it is a swallowed failure).
    const { tool } = build(armed(), { apply: async () => false })
    const result = await tool.handler({ app: 'Notepad', state: 'maximized' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("didn't reach that state")
    expect(result.content[0]?.text).not.toContain('is maximized')
  })

  it('reports an app that is not open instead of guessing', async () => {
    const { tool, applied } = build(armed(), { findPid: async () => null })
    const result = await tool.handler({ app: 'Ghost', state: 'maximized' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('list_open_apps')
    expect(applied).toEqual([])
  })

  it('enforces the CLICK tier against standing grants, and a denial stops the change', async () => {
    // A display-only envelope arms (so the plan gate passes) but authorizes
    // nothing — the unattended shape — which is what forces the fall-through to
    // the standing grant gate this assertion is about. Arranging a window
    // changes the screen but types nothing: click, not full.
    const displayOnly = createDesktopPlanEnvelope('display-only')
    displayOnly.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'click' }] })
    const seen: Array<{ appName: string; required: string }> = []
    const { tool, applied } = build(displayOnly, {
      authorize: (appName, required) => {
        seen.push({ appName, required })
        throw new ForbiddenError('Desktop access denied for "Notepad".')
      },
    })
    const result = await tool.handler({ app: 'Notepad', state: 'minimized' })
    expect(seen[0]?.required).toBe('click')
    expect(result.isError).toBe(true)
    expect(applied).toEqual([])
  })

  it('an armed plan covering the app satisfies it without a standing grant', async () => {
    // The plan-envelope short-circuit: a covered app never reaches the standing
    // gate, which is exactly what makes one approval cover the whole task.
    let standingCalls = 0
    const { tool, applied } = build(armed(), {
      authorize: () => {
        standingCalls += 1
        throw new ForbiddenError('no standing grant')
      },
    })
    const result = await tool.handler({ app: 'Notepad', state: 'maximized' })
    expect(result.isError).not.toBe(true)
    expect(standingCalls).toBe(0)
    expect(applied).toEqual([{ pid: 42, state: 'maximized' }])
  })
})

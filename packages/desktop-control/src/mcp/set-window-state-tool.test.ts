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
    appNameByPid?: (pid: number) => string | null
  } = {},
) {
  const applied: Array<{ pid: number; state: WindowState }> = []
  const tool = makeSetWindowStateTool(envelope, {
      findPid: overrides.findPid ?? (async () => 42),
      // Injected so these tests never load the capture binary — the default
      // identity lookup reaches node-screenshots (the request_desktop_access
      // precedent).
      appNameByPid: overrides.appNameByPid ?? (() => 'Notepad'),
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

  it('an UNATTENDED turn cannot arrange a window, and nothing changes', async () => {
    // display-only ARMS (so the plan gate passes) but authorizes nothing. That
    // used to fall through to a standing per-app grant; with grants retired it
    // is the end of the road — the conservative direction, and the one case
    // where "propose a better plan" would be useless advice.
    const displayOnly = createDesktopPlanEnvelope('display-only')
    displayOnly.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'click' }] })
    const { tool, applied } = build(displayOnly)
    const result = await tool.handler({ app: 'Notepad', state: 'minimized' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/unattended/i)
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

// The packaged-app class. Calculator and Settings share one ApplicationFrameHost
// pid, so `apply` acting on that pid's MainWindowHandle can hit EITHER app.
// This tool used to pass the model's own `query` as the identity fallback,
// which meant "minimize Calculator" could authorize as Calculator and minimize
// Settings — the same hole its twin set_window_bounds had.
describe('set_window_state — an unidentifiable window', () => {
  it('changes NOTHING when the identity is ambiguous', async () => {
    const { tool, applied } = build(armed(), { appNameByPid: () => null })
    const result = await tool.handler({ app: 'Calculator', state: 'minimized' })
    expect(result.isError).toBe(true)
    expect(applied).toEqual([])
  })

  it('does not send the model round a rename loop it cannot win', async () => {
    // list_open_apps can only see ONE packaged app at a time, so "name it
    // exactly" would be advice the tool itself makes impossible to follow.
    const { tool } = build(armed(), { appNameByPid: () => null })
    const text = (await tool.handler({ app: 'Calculator', state: 'minimized' })).content[0]?.text
    expect(text).toMatch(/one shared process/i)
    expect(text).toMatch(/different name will fail the same way/i)
    expect(text).not.toMatch(/list_open_apps/i)
  })

  it('never authorizes against the name the MODEL supplied', async () => {
    const seen: string[] = []
    const { tool } = build(armed(), {
      appNameByPid: () => null,
      authorize: (appName) => {
        seen.push(appName)
      },
    })
    await tool.handler({ app: 'Calculator', state: 'minimized' })
    expect(seen).not.toContain('Calculator')
    expect(seen).toEqual([])
  })
})

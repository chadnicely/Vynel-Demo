// The gate and the reporting for `set_window_bounds`. Driven through the handler
// with injected deps (the `set-window-state-tool` precedent), so no PowerShell
// spawns and no window moves.

import { describe, expect, it } from 'vitest'
import { makeSetWindowBoundsTool } from './set-window-bounds-tool.js'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import type { SetWindowBoundsOutcome } from '../a11y/window-bounds.js'

type BuiltTool = {
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

const armed = () => {
  const envelope = createDesktopPlanEnvelope('standing-consent')
  envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Chrome', tier: 'click' }] })
  return envelope
}

function build(
  apply: (pid: number, bounds: { x: number; y: number; width: number; height: number }) => Promise<SetWindowBoundsOutcome>,
  envelope = armed(),
) {
  return makeSetWindowBoundsTool(envelope, {
    findPid: async () => 4242,
    appNameByPid: () => 'Chrome',
    apply,
  }) as unknown as BuiltTool
}

const echo = async (
  _pid: number,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<SetWindowBoundsOutcome> => ({ ok: true, applied: bounds })

const textOf = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? ''

describe('set_window_bounds — the gate', () => {
  it('refuses without an armed plan', async () => {
    const tool = build(echo, createDesktopPlanEnvelope('standing-consent'))
    const result = await tool.handler({ app: 'Chrome', x: 0, y: 0, width: 800, height: 600 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/propose_desktop_plan/)
  })

  it('validates the rectangle BEFORE resolving or moving anything', async () => {
    let applied = false
    const tool = build(async (pid, bounds) => {
      applied = true
      return { ok: true, applied: bounds }
    })
    const result = await tool.handler({ app: 'Chrome', x: 0, y: 0, width: 5, height: 600 })
    expect(result.isError).toBe(true)
    expect(applied).toBe(false)
  })
})

describe('set_window_bounds — placement', () => {
  // The whole point of the tool: "put it on my other screen". A display left of
  // or above the primary has NEGATIVE coordinates, verified live to land
  // exactly on the portrait panel.
  it('accepts negative coordinates for a monitor left of / above the primary', async () => {
    const seen: Array<Record<string, number>> = []
    const tool = build(async (_pid, bounds) => {
      seen.push({ ...bounds })
      return { ok: true, applied: bounds }
    })
    const result = await tool.handler({
      app: 'Chrome',
      x: -1080,
      y: -847,
      width: 864,
      height: 1536,
    })
    expect(result.isError).toBeUndefined()
    expect(seen[0]).toEqual({ x: -1080, y: -847, width: 864, height: 1536 })
  })

  it('reports the rectangle the window ACTUALLY took, flagging a clamp', async () => {
    // An app may refuse a size. Echoing the request instead would have the model
    // aim its next click at a rectangle that does not exist.
    const tool = build(async () => ({
      ok: true,
      applied: { x: 0, y: 0, width: 500, height: 400 },
    }))
    const result = await tool.handler({ app: 'Chrome', x: 0, y: 0, width: 300, height: 400 })
    expect(textOf(result)).toMatch(/500x400/)
    expect(textOf(result)).toMatch(/adjusted/)
  })

  it('does not cry "adjusted" when the window took exactly what was asked', async () => {
    const tool = build(echo)
    const result = await tool.handler({ app: 'Chrome', x: 10, y: 20, width: 800, height: 600 })
    expect(textOf(result)).toMatch(/800x600/)
    expect(textOf(result)).not.toMatch(/adjusted/)
  })

  // A tray-minimized app has no main window handle — its recovery is launch_app,
  // not "try a different rectangle".
  it('points at launch_app when there is no reachable window', async () => {
    const tool = build(async () => ({ ok: false, reason: 'no-window' }))
    const result = await tool.handler({ app: 'Docker', x: 0, y: 0, width: 800, height: 600 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/system tray/)
    expect(textOf(result)).toMatch(/launch_app/)
  })
})

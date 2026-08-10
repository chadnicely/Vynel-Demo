import { describe, it, expect } from 'vitest'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { PLAN_REQUIRED_MESSAGE } from '../plan/plan-gated-authorization.js'
import { makeActOnDesktopTool } from './act-on-desktop-tool.js'

// The tool factory returns an SDK tool object; we can't drive its handler here
// without the native engine, so this asserts construction + the pre-flight
// gates that fire BEFORE the engine (plan refusal, action validation). The
// handler's fail-closed paths are covered by desktop-input.test.ts (pre-load
// validation); the plan/grant authorization composition by
// plan-gated-authorization.test.ts.
type BuiltTool = {
  name?: string
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

const armedEnvelope = () => {
  const envelope = createDesktopPlanEnvelope('standing-consent')
  envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'full' }] })
  return envelope
}

describe('makeActOnDesktopTool', () => {
  it('constructs a tool named act_on_desktop', () => {
    const built = makeActOnDesktopTool(createDesktopPlanEnvelope('standing-consent')) as BuiltTool
    expect(built.name).toBe('act_on_desktop')
  })

  it('refuses to act without an armed plan — in any consent mode', async () => {
    const built = makeActOnDesktopTool(createDesktopPlanEnvelope('standing-consent')) as BuiltTool
    const result = await built.handler({ action: 'click', x: 1, y: 1 })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe(PLAN_REQUIRED_MESSAGE)
  })

  it('rejects an unknown action without touching the engine', async () => {
    const built = makeActOnDesktopTool(armedEnvelope()) as BuiltTool
    const result = await built.handler({ action: 'teleport' })
    expect(result.isError).toBe(true)
  })
})

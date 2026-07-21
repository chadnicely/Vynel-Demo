import { describe, it, expect } from 'vitest'
import { makeActOnDesktopTool } from './act-on-desktop-tool.js'

// The tool factory returns an SDK tool object; we can't drive its handler here
// without the native engine, so this asserts construction + the identity that
// makes it card (the mutating name is declared on the descriptor). The handler's
// fail-closed paths are covered by desktop-input.test.ts (pre-load validation).
describe('makeActOnDesktopTool', () => {
  it('constructs a tool named act_on_desktop', () => {
    const built = makeActOnDesktopTool() as { name?: string }
    expect(built.name).toBe('act_on_desktop')
  })

  it('rejects an unknown action without touching the engine', async () => {
    const built = makeActOnDesktopTool() as {
      handler: (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: unknown }>
    }
    const result = await built.handler({ action: 'teleport' })
    expect(result.isError).toBe(true)
  })
})

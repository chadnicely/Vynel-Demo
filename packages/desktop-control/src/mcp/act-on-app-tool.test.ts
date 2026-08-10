import { describe, it, expect } from 'vitest'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { PLAN_REQUIRED_MESSAGE } from '../plan/plan-gated-authorization.js'
import { buildActResponse, makeActOnAppTool } from './act-on-app-tool.js'

describe('buildActResponse', () => {
  it('reports a completed action', () => {
    const text =
      buildActResponse('Calculator', { kind: 'done', action: 'press', selector: 'button[name="Five"]' })
        .content[0]?.text ?? ''
    expect(text).toContain('Done: press on button[name="Five"]')
    expect(text).toContain('Calculator')
  })

  it('lists candidates with stable_ids when the selector is ambiguous, and takes no action', () => {
    const text =
      buildActResponse('Calculator', {
        kind: 'ambiguous',
        selector: 'button',
        matchCount: 3,
        candidates: [
          { stableId: 'num5Button', role: 'button', name: 'Five' },
          { stableId: 'plusButton', role: 'button', name: 'Plus' },
        ],
      }).content[0]?.text ?? ''
    expect(text).toContain('matched 3 elements')
    expect(text).toContain('no action taken')
    expect(text).toContain('[stable_id="num5Button"]')
  })
})

describe('makeActOnAppTool', () => {
  it('is named act_on_app and marked DESTRUCTIVE, not read-only', () => {
    // The destructive annotation is the safety contract — a flip to read-only
    // (or a name typo) would mis-class the one mutating desktop tool.
    const toolDefinition = makeActOnAppTool(createDesktopPlanEnvelope('standing-consent')) as {
      name: string
      annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean }
    }
    expect(toolDefinition.name).toBe('act_on_app')
    expect(toolDefinition.annotations?.destructiveHint).toBe(true)
    expect(toolDefinition.annotations?.readOnlyHint).not.toBe(true)
  })

  it('refuses to act without an armed plan — in any consent mode', async () => {
    const built = makeActOnAppTool(createDesktopPlanEnvelope('standing-consent')) as {
      handler: (args: Record<string, unknown>) => Promise<{
        isError?: boolean
        content: Array<{ type: string; text?: string }>
      }>
    }
    const result = await built.handler({ app: 'Notepad', selector: 'button[name="Save"]', action: 'press' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe(PLAN_REQUIRED_MESSAGE)
  })
})

import { describe, it, expect } from 'vitest'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { PLAN_REQUIRED_MESSAGE } from '../plan/plan-gated-authorization.js'
import {
  makeActOnDesktopTool,
  parseActOnDesktopParams,
  parseActOnDesktopSteps,
} from './act-on-desktop-tool.js'

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

  it('rejects a malformed batch without touching the engine', async () => {
    const built = makeActOnDesktopTool(armedEnvelope()) as BuiltTool
    const result = await built.handler({ actions: [{ action: 'teleport' }] })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('"actions" must be')
  })

  it('rejects a call carrying BOTH a single action and a batch', async () => {
    // Silently dropping one of the two would run something the model didn't
    // mean; both tools' error text promises "EITHER … OR".
    const built = makeActOnDesktopTool(armedEnvelope()) as BuiltTool
    const result = await built.handler({
      action: 'click',
      x: 1,
      y: 2,
      actions: [{ action: 'press', keys: 'enter' }],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not both')
  })
})

describe('parseActOnDesktopParams', () => {
  it('takes the app from the CALL, never from the step (a batch cannot wander)', () => {
    // A step trying to name its own window must not change the coordinate
    // frame the call was authorized against.
    const params = parseActOnDesktopParams({ action: 'click', x: 1, y: 2, app: 'Discord' }, 'Notepad')
    expect(params?.app).toBe('Notepad')
    expect(parseActOnDesktopParams({ action: 'click', x: 1, y: 2 }, undefined)?.app).toBeUndefined()
  })

  it('carries every optional field through, and drops mistyped ones', () => {
    expect(
      parseActOnDesktopParams(
        {
          action: 'click',
          x: 5,
          y: 6,
          button: 'right',
          double: true,
          direction: 'up',
          amount: 2,
          text: 'hi',
          keys: 'enter',
          toX: 9,
          toY: 10,
        },
        'Notepad',
      ),
    ).toEqual({
      action: 'click',
      x: 5,
      y: 6,
      toX: 9,
      toY: 10,
      text: 'hi',
      keys: 'enter',
      app: 'Notepad',
      amount: 2,
      button: 'right',
      double: true,
      direction: 'up',
    })
    // Mistyped values are dropped rather than passed to the engine; the
    // action-level validation in planDesktopAction then fails closed.
    expect(
      parseActOnDesktopParams({ action: 'click', x: '5', button: 'sideways', double: 'yes' }, undefined),
    ).toEqual({ action: 'click' })
  })

  it('is null for an unknown action', () => {
    expect(parseActOnDesktopParams({ action: 'teleport' }, undefined)).toBeNull()
    expect(parseActOnDesktopParams({}, undefined)).toBeNull()
  })
})

describe('parseActOnDesktopSteps', () => {
  it('parses a batch, stamping the call-level app onto every step', () => {
    expect(
      parseActOnDesktopSteps(
        [
          { action: 'click', x: 10, y: 20 },
          { action: 'type', text: 'hello' },
          { action: 'press', keys: 'enter' },
        ],
        'Google Chrome',
      ),
    ).toEqual([
      { action: 'click', x: 10, y: 20, app: 'Google Chrome' },
      { action: 'type', text: 'hello', app: 'Google Chrome' },
      { action: 'press', keys: 'enter', app: 'Google Chrome' },
    ])
  })

  it('rejects empties, bad entries, and oversize batches', () => {
    expect(parseActOnDesktopSteps(undefined, undefined)).toBeNull()
    expect(parseActOnDesktopSteps([], undefined)).toBeNull()
    expect(parseActOnDesktopSteps(['nope'], undefined)).toBeNull()
    expect(parseActOnDesktopSteps([{ action: 'teleport' }], undefined)).toBeNull()
    expect(
      parseActOnDesktopSteps(
        Array.from({ length: 21 }, () => ({ action: 'click', x: 1, y: 1 })),
        undefined,
      ),
    ).toBeNull()
  })

  it('validates EVERY step up front, so a malformed batch is ATOMIC', () => {
    // A step missing its required fields must reject the WHOLE batch — with
    // separate calls a bad call mutated nothing, and a half-run batch would
    // leave the screen part-way through (click landed, type rejected).
    expect(
      parseActOnDesktopSteps(
        [
          { action: 'click', x: 10, y: 20 },
          { action: 'type' }, // no text
        ],
        'Notepad',
      ),
    ).toBeNull()
    expect(parseActOnDesktopSteps([{ action: 'press' }], undefined)).toBeNull()
    expect(parseActOnDesktopSteps([{ action: 'click', x: 1 }], undefined)).toBeNull()
    expect(
      parseActOnDesktopSteps([{ action: 'drag', x: 1, y: 2, toX: 3 }], undefined),
    ).toBeNull()
  })
})

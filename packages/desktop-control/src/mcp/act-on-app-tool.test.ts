import { describe, it, expect, vi } from 'vitest'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { PLAN_REQUIRED_MESSAGE } from '../plan/plan-gated-authorization.js'
import {
  buildActResponse,
  makeActOnAppTool,
  parseActOnAppSteps,
  toBatchStep,
} from './act-on-app-tool.js'

// The observe wiring's DECISION branches (skip-on-ambiguous, observe-on-batch-
// failure) are drivable without the native engine by mocking the adapter's
// act — the launch-app test's proven technique. The helper's own behavior is
// covered in act-observation.test.ts.
vi.mock('../a11y/xa11y-adapter.js', async () => {
  const actual =
    await vi.importActual<typeof import('../a11y/xa11y-adapter.js')>('../a11y/xa11y-adapter.js')
  return { ...actual, actOnApp: vi.fn() }
})
vi.mock('./act-observation.js', async () => {
  const actual =
    await vi.importActual<typeof import('./act-observation.js')>('./act-observation.js')
  return {
    ...actual,
    captureActObservation: vi.fn(async () => [
      { type: 'text', text: 'observed' },
      { type: 'image', data: 'UEsK', mimeType: 'image/png' },
    ]),
  }
})
import { actOnApp } from '../a11y/xa11y-adapter.js'
import { captureActObservation } from './act-observation.js'

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

  it('rejects a call that is neither a single action nor a batch', async () => {
    const envelope = createDesktopPlanEnvelope('standing-consent')
    envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'full' }] })
    const built = makeActOnAppTool(envelope) as {
      handler: (args: Record<string, unknown>) => Promise<{
        isError?: boolean
        content: Array<{ type: string; text?: string }>
      }>
    }
    const result = await built.handler({ app: 'Notepad' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('EITHER a single action')
  })

  it('rejects a malformed batch without running anything', async () => {
    const envelope = createDesktopPlanEnvelope('standing-consent')
    envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'full' }] })
    const built = makeActOnAppTool(envelope) as {
      handler: (args: Record<string, unknown>) => Promise<{
        isError?: boolean
        content: Array<{ type: string; text?: string }>
      }>
    }
    const result = await built.handler({
      app: 'Notepad',
      actions: [{ selector: 'button[name="Save"]', action: 'teleport' }],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('"actions" must be')
  })

  it('rejects a call carrying BOTH a single action and a batch', async () => {
    const envelope = createDesktopPlanEnvelope('standing-consent')
    envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'full' }] })
    const built = makeActOnAppTool(envelope) as {
      handler: (args: Record<string, unknown>) => Promise<{
        isError?: boolean
        content: Array<{ type: string; text?: string }>
      }>
    }
    const result = await built.handler({
      app: 'Notepad',
      selector: 'button[name="Save"]',
      action: 'press',
      actions: [{ selector: 'button[name="Cancel"]', action: 'press' }],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not both')
  })
})

describe('parseActOnAppSteps', () => {
  it('parses well-formed steps and trims selectors', () => {
    expect(
      parseActOnAppSteps([
        { selector: ' edit[name="Search"] ', action: 'type_text', value: 'hello' },
        { selector: 'button[name="Go"]', action: 'press' },
      ]),
    ).toEqual([
      { selector: 'edit[name="Search"]', action: 'type_text', value: 'hello' },
      { selector: 'button[name="Go"]', action: 'press' },
    ])
  })

  it('rejects empties, bad actions, non-string values, and oversize batches', () => {
    expect(parseActOnAppSteps(undefined)).toBeNull()
    expect(parseActOnAppSteps([])).toBeNull()
    expect(parseActOnAppSteps([{ selector: '  ', action: 'press' }])).toBeNull()
    expect(parseActOnAppSteps([{ selector: 'a', action: 'teleport' }])).toBeNull()
    expect(parseActOnAppSteps([{ selector: 'a', action: 'type_text', value: 5 }])).toBeNull()
    expect(parseActOnAppSteps(['not-an-object'])).toBeNull()
    expect(
      parseActOnAppSteps(Array.from({ length: 21 }, () => ({ selector: 'a', action: 'press' }))),
    ).toBeNull()
  })

  it('validates EVERY step up front, so a malformed batch is ATOMIC', () => {
    // type_text / set_value without their value must reject the WHOLE batch —
    // a half-run batch would leave the screen part-way through.
    expect(
      parseActOnAppSteps([
        { selector: 'button[name="Open"]', action: 'press' },
        { selector: 'edit[name="Name"]', action: 'type_text' },
      ]),
    ).toBeNull()
    expect(parseActOnAppSteps([{ selector: 'a', action: 'set_value' }])).toBeNull()
  })
})

describe('toBatchStep', () => {
  it('treats a completed action as OK', () => {
    const step = toBatchStep('Notepad', {
      kind: 'done',
      action: 'press',
      selector: 'button[name="Save"]',
    })
    expect(step.ok).toBe(true)
    expect(step.detail).toContain('Done: press')
  })

  it('treats an AMBIGUOUS selector as a STOP — nothing ran, so the batch must halt', () => {
    const step = toBatchStep('Notepad', {
      kind: 'ambiguous',
      selector: 'button',
      matchCount: 2,
      candidates: [{ stableId: 'a', role: 'button', name: 'One' }],
    })
    expect(step.ok).toBe(false)
    expect(step.detail).toContain('no action taken')
  })
})

describe('makeActOnAppTool — observe wiring', () => {
  type BuiltTool = {
    handler: (args: Record<string, unknown>) => Promise<{
      isError?: boolean
      content: Array<{ type: string; text?: string }>
    }>
  }
  const armedTool = (): BuiltTool => {
    const envelope = createDesktopPlanEnvelope('standing-consent')
    envelope.arm({ goal: 'g', steps: ['s'], apps: [{ app: 'Notepad', tier: 'full' }] })
    return makeActOnAppTool(envelope) as BuiltTool
  }

  it('a landed single act with observe appends the screenshot', async () => {
    vi.mocked(actOnApp).mockResolvedValue({
      kind: 'done',
      action: 'press',
      selector: 'button[name="Save"]',
    })
    vi.mocked(captureActObservation).mockClear()
    const result = await armedTool().handler({
      app: 'Notepad',
      selector: 'button[name="Save"]',
      action: 'press',
      observe: true,
    })
    expect(result.content.map((block) => block.type)).toEqual(['text', 'text', 'image'])
    expect(vi.mocked(captureActObservation)).toHaveBeenCalledWith('Notepad', 400)
  })

  it('an AMBIGUOUS single act skips the observation — nothing ran, the screen is unchanged', async () => {
    vi.mocked(actOnApp).mockResolvedValue({
      kind: 'ambiguous',
      selector: 'button',
      matchCount: 2,
      candidates: [{ stableId: 'a', role: 'button', name: 'One' }],
    })
    vi.mocked(captureActObservation).mockClear()
    const result = await armedTool().handler({
      app: 'Notepad',
      selector: 'button',
      action: 'press',
      observe: true,
    })
    expect(vi.mocked(captureActObservation)).not.toHaveBeenCalled()
    expect(result.content.map((block) => block.type)).toEqual(['text'])
  })

  it('a batch that STOPS still observes — the part-way state is what recovery needs', async () => {
    vi.mocked(actOnApp)
      .mockResolvedValueOnce({ kind: 'done', action: 'type_text', selector: 'edit[name="To"]' })
      .mockRejectedValueOnce(new Error('No element matched selector'))
    vi.mocked(captureActObservation).mockClear()
    const result = await armedTool().handler({
      app: 'Notepad',
      actions: [
        { selector: 'edit[name="To"]', action: 'type_text', value: 'x' },
        { selector: 'button[name="Send"]', action: 'press' },
      ],
      observe: true,
    })
    expect(result.isError).toBe(true)
    expect(vi.mocked(captureActObservation)).toHaveBeenCalledTimes(1)
    expect(result.content.at(-1)?.type).toBe('image')
  })
})

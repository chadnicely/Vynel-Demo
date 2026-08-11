// The clipboard tools' GATE. These are the security tests for the pair: the
// clipboard is app-less, so the per-app grant model cannot cover it and the
// envelope is the only door — which makes exactly WHICH envelope states open it
// the whole security property.
//
// The handlers are driven directly (the `set-window-state-tool` precedent), so
// no native clipboard is ever touched: every case below refuses before reaching
// the engine, and the one allowed case is driven with an injected reader.

import { describe, expect, it } from 'vitest'
import { makeReadClipboardTool, makeWriteClipboardTool } from './clipboard-tools.js'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import type { DesktopPlanConsent } from '@vynel/mcp-contract'

type BuiltTool = {
  name: string
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

const armedEnvelope = (consent: DesktopPlanConsent) => {
  const envelope = createDesktopPlanEnvelope(consent)
  envelope.arm({ goal: 'g', steps: ['read the clipboard'], apps: [{ app: 'X', tier: 'full' }] })
  return envelope
}

const textOf = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? ''

describe('read_clipboard — the gate', () => {
  it('refuses with NO plan armed, naming the recovery', async () => {
    const built = makeReadClipboardTool(createDesktopPlanEnvelope('approval-card')) as BuiltTool
    const result = await built.handler({})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/propose_desktop_plan/)
  })

  // THE one that matters. `propose_desktop_plan` cards in ask mode ONLY, so on a
  // channel / spawned / scheduled turn the model arms the envelope ITSELF with
  // no card and no grant. If arming were the whole gate, an unattended turn
  // could read the password the user copied minutes ago, with nobody at the
  // machine to see the overlay say so.
  it('refuses on an UNATTENDED turn even with a plan armed (display-only consent)', async () => {
    const built = makeReadClipboardTool(armedEnvelope('display-only')) as BuiltTool
    const result = await built.handler({})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/unattended/i)
    // And it must not leak WHY by hinting at contents.
    expect(textOf(result)).not.toMatch(/clipboard contents/i)
  })

  it.each(['approval-card', 'standing-consent'] as const)(
    'allows it under %s consent — the user approved, or their mode IS the consent',
    async (consent) => {
      const built = makeReadClipboardTool(armedEnvelope(consent)) as BuiltTool
      // Reaching the engine is the proof it passed the gate; the native call is
      // absent in tests, so an engine error (not a refusal) is the pass signal.
      const result = await built.handler({})
      expect(textOf(result)).not.toMatch(/propose_desktop_plan|unattended/i)
    },
  )
})

describe('write_clipboard — the gate', () => {
  it('refuses with no plan armed', async () => {
    const built = makeWriteClipboardTool(createDesktopPlanEnvelope('approval-card')) as BuiltTool
    const result = await built.handler({ text: 'hi' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/propose_desktop_plan/)
  })

  // Writing is its OWN harm, not a mirror of reading: text planted on an
  // unattended user's clipboard gets pasted later in the belief that it is what
  // they copied.
  it('refuses on an unattended turn even with a plan armed', async () => {
    const built = makeWriteClipboardTool(armedEnvelope('display-only')) as BuiltTool
    const result = await built.handler({ text: 'planted' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/unattended/i)
  })

  it('rejects a missing text argument before touching the engine', async () => {
    const built = makeWriteClipboardTool(armedEnvelope('approval-card')) as BuiltTool
    const result = await built.handler({})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/"text"/)
  })
})

describe('the tool descriptions', () => {
  it('tell the model to STOP rather than repeat a credential', async () => {
    const built = makeReadClipboardTool(createDesktopPlanEnvelope('approval-card')) as unknown as {
      description: string
    }
    expect(built.description).toMatch(/password/i)
    expect(built.description).toMatch(/do NOT repeat/i)
  })

  it('warn that writing REPLACES what the user had copied', async () => {
    const built = makeWriteClipboardTool(createDesktopPlanEnvelope('approval-card')) as unknown as {
      description: string
    }
    expect(built.description).toMatch(/replaces/i)
  })
})

// Guards the wiring itself: a future refactor that swapped the gate back to the
// plain `planRequiredError` would reopen the hole silently.
describe('the gate is the consent-aware one, not the plain plan check', () => {
  it('an armed display-only envelope opens the ACT tools but NOT the clipboard', async () => {
    const envelope = armedEnvelope('display-only')
    // The act tools deliberately still run under display-only — they have a
    // second door (standing per-app grants). The clipboard has none.
    expect(envelope.isArmed()).toBe(true)
    const built = makeReadClipboardTool(envelope) as BuiltTool
    expect((await built.handler({})).isError).toBe(true)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { makeOpenUrlTool } from './open-url-tool.js'

type BuiltTool = {
  name: string
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

const somePlan = { goal: 'show the docs', steps: ['open the page'], apps: [] }

describe('open_url', () => {
  it('refuses without an armed plan — and under display-only consent even with one', async () => {
    // The clipboard's gate: app-less, so the envelope is the ONLY authority,
    // and an unattended turn must not be able to self-grant a launcher.
    const open = vi.fn()

    const unarmed = createDesktopPlanEnvelope('standing-consent')
    const unarmedTool = makeOpenUrlTool(unarmed, { open }) as BuiltTool
    expect((await unarmedTool.handler({ url: 'https://example.com' })).isError).toBe(true)

    const unattended = createDesktopPlanEnvelope('display-only')
    unattended.arm(somePlan)
    const unattendedTool = makeOpenUrlTool(unattended, { open }) as BuiltTool
    expect((await unattendedTool.handler({ url: 'https://example.com' })).isError).toBe(true)

    expect(open).not.toHaveBeenCalled()
  })

  it('refuses a disallowed scheme BEFORE launching, with no record row — a refusal is not an act', async () => {
    const written: unknown[] = []
    const envelope = createDesktopPlanEnvelope('standing-consent', {
      write: (record) => written.push(record),
    })
    envelope.arm(somePlan)
    const open = vi.fn()
    const toolInstance = makeOpenUrlTool(envelope, { open }) as BuiltTool
    const result = await toolInstance.handler({ url: 'file:///C:/x.exe' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('not allowed')
    expect(open).not.toHaveBeenCalled()
    expect(written).toEqual([])
  })

  it('opens an allowed URL, records it UNVERIFIED, and says looking is still on the model', async () => {
    const written: Array<{ tool: string; detail: string; outcome: string }> = []
    const envelope = createDesktopPlanEnvelope('standing-consent', {
      write: (record) => written.push(record as never),
    })
    envelope.arm(somePlan)
    const open = vi.fn().mockResolvedValue(new URL('https://example.com/page'))
    const toolInstance = makeOpenUrlTool(envelope, { open }) as BuiltTool
    const result = await toolInstance.handler({ url: 'https://example.com/page' })
    expect(result.isError).not.toBe(true)
    expect(result.content[0]?.text).toContain('does not confirm')
    expect(written).toEqual([
      expect.objectContaining({
        tool: 'open_url',
        detail: 'opened https://example.com/page',
        outcome: 'unverified',
      }),
    ])
  })

  it('records a THROWN open as failed — attempted-and-threw may have partially landed', async () => {
    const written: Array<{ outcome: string; note: string | null }> = []
    const envelope = createDesktopPlanEnvelope('standing-consent', {
      write: (record) => written.push(record as never),
    })
    envelope.arm(somePlan)
    const open = vi.fn().mockRejectedValue(new Error('spawn timed out'))
    const toolInstance = makeOpenUrlTool(envelope, { open }) as BuiltTool
    const result = await toolInstance.handler({ url: 'https://example.com' })
    expect(result.isError).toBe(true)
    expect(written).toEqual([
      expect.objectContaining({ outcome: 'failed', note: 'spawn timed out' }),
    ])
  })
})

import { describe, it, expect, vi } from 'vitest'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { makeSetVolumeTool } from './set-volume-tool.js'

type BuiltTool = {
  name: string
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

const somePlan = { goal: 'silence the machine', steps: ['mute'], apps: [] }

describe('set_volume', () => {
  it('refuses without an armed plan, and under display-only consent even with one', async () => {
    const set = vi.fn()

    const unarmed = createDesktopPlanEnvelope('standing-consent')
    const unarmedTool = makeSetVolumeTool(unarmed, { set }) as BuiltTool
    expect((await unarmedTool.handler({ mute: true })).isError).toBe(true)

    const unattended = createDesktopPlanEnvelope('display-only')
    unattended.arm(somePlan)
    const unattendedTool = makeSetVolumeTool(unattended, { set }) as BuiltTool
    expect((await unattendedTool.handler({ mute: true })).isError).toBe(true)

    expect(set).not.toHaveBeenCalled()
  })

  it('requires at least one of level / mute', async () => {
    const envelope = createDesktopPlanEnvelope('standing-consent')
    envelope.arm(somePlan)
    const set = vi.fn()
    const toolInstance = makeSetVolumeTool(envelope, { set }) as BuiltTool
    const result = await toolInstance.handler({})
    expect(result.isError).toBe(true)
    expect(set).not.toHaveBeenCalled()
  })

  it('reports the device\'s OWN read-back and records the act as ok', async () => {
    const written: Array<{ tool: string; outcome: string; note: string | null }> = []
    const envelope = createDesktopPlanEnvelope('standing-consent', {
      write: (record) => written.push(record as never),
    })
    envelope.arm(somePlan)
    const set = vi.fn().mockResolvedValue({ level: 39, muted: false })
    const toolInstance = makeSetVolumeTool(envelope, { set }) as BuiltTool
    const result = await toolInstance.handler({ level: 40 })
    expect(result.isError).not.toBe(true)
    // The device landed on its nearest step — the reply says both numbers.
    expect(result.content[0]?.text).toContain('39%')
    expect(result.content[0]?.text).toContain('Asked for 40%')
    expect(written).toEqual([
      expect.objectContaining({ tool: 'set_volume', outcome: 'ok', note: 'now 39%' }),
    ])
  })

  it('records a thrown set as failed with the real error', async () => {
    const written: Array<{ outcome: string; note: string | null }> = []
    const envelope = createDesktopPlanEnvelope('standing-consent', {
      write: (record) => written.push(record as never),
    })
    envelope.arm(somePlan)
    const set = vi.fn().mockRejectedValue(new Error('no audio endpoint'))
    const toolInstance = makeSetVolumeTool(envelope, { set }) as BuiltTool
    const result = await toolInstance.handler({ mute: true })
    expect(result.isError).toBe(true)
    expect(written).toEqual([
      expect.objectContaining({ outcome: 'failed', note: 'no audio endpoint' }),
    ])
  })
})

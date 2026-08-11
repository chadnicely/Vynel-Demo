import { describe, expect, it } from 'vitest'
import { makeWaitForTool } from './wait-for-tool.js'
import type { WaitClock, WaitProbes } from '../a11y/wait-for-condition.js'

type BuiltTool = {
  name: string
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text?: string }>
  }>
}

function instantClock(): WaitClock {
  let current = 0
  return {
    now: () => current,
    sleep: async (ms) => {
      current += ms
    },
  }
}

const build = (probes: WaitProbes) =>
  makeWaitForTool(undefined, { probes, clock: instantClock() }) as unknown as BuiltTool

const textOf = (result: { content: Array<{ text?: string }> }) => result.content[0]?.text ?? ''

describe('wait_for — argument guards (before any waiting)', () => {
  const probes: WaitProbes = { readTree: async () => 'x', isAppOpen: async () => true }

  it('requires an app and a valid condition', async () => {
    const tool = build(probes)
    expect((await tool.handler({ until: 'app_appears' })).isError).toBe(true)
    expect((await tool.handler({ app: 'X', until: 'nonsense' })).isError).toBe(true)
  })

  // Without this the tool would burn the whole timeout looking for '', which
  // EVERY tree trivially contains — so it would report success immediately and
  // teach the model that the wait works when it never ran.
  it('refuses a text condition with no text, rather than matching the empty string', async () => {
    const tool = build(probes)
    for (const until of ['text_appears', 'text_disappears']) {
      const result = await tool.handler({ app: 'X', until, text: '' })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/non-empty "text"/)
    }
  })

  it('does NOT require text for the existence conditions', async () => {
    const tool = build(probes)
    expect((await tool.handler({ app: 'X', until: 'app_appears' })).isError).toBeUndefined()
  })
})

describe('wait_for — outcomes', () => {
  it('reports success with how long it took', async () => {
    const tool = build({ readTree: async () => 'Upload complete', isAppOpen: async () => true })
    const result = await tool.handler({ app: 'X', until: 'text_appears', text: 'complete' })
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toMatch(/met after/)
  })

  // A timeout must not read as success, but it also must not send the model
  // into a blind retry loop — the screen is the thing to consult.
  it('reports a timeout as an error that steers to LOOKING, not retrying', async () => {
    const tool = build({ readTree: async () => 'still loading', isAppOpen: async () => false })
    const result = await tool.handler({
      app: 'X',
      until: 'text_appears',
      text: 'never',
      timeoutMs: 2_000,
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/Do NOT just wait again/)
    expect(textOf(result)).toMatch(/snapshot_app/)
  })

  it('surfaces a persistent read failure in the timeout message', async () => {
    const tool = build({
      readTree: async () => {
        throw new Error('window vanished')
      },
      isAppOpen: async () => false,
    })
    const result = await tool.handler({
      app: 'X',
      until: 'text_appears',
      text: 'anything',
      timeoutMs: 1_000,
    })
    expect(textOf(result)).toMatch(/window vanished/)
  })

  it('is declared READ-ONLY — it observes and changes nothing, so it needs no plan', () => {
    const tool = makeWaitForTool() as unknown as { annotations?: { readOnlyHint?: boolean } }
    expect(tool.annotations?.readOnlyHint).toBe(true)
  })
})

// Tests for `runClaudeModelDiscovery` — the roster read that costs nothing:
// it must open a query, take the engine's startup handshake, and close again
// WITHOUT sending a message or running a turn, and it must degrade to null
// (never to an empty picker) on every failure shape.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { runClaudeModelDiscovery } from './run-claude-model-discovery.js'

const mockQuery = vi.mocked(query)

const BASE = { workspacePath: '/work/demo' }

/** A query stub that answers `initializationResult()` however the test says. */
function fakeQuery(initialization: () => Promise<{ models: unknown[] }>) {
  return () =>
    ({
      initializationResult: initialization,
      // Never iterated by discovery — present so the object is query-shaped.
      async *[Symbol.asyncIterator]() {},
    }) as never
}

const OPUS_ROW = {
  value: 'claude-opus-4-8',
  displayName: 'Opus 4.8',
  description: 'Most capable',
  supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
}

describe('runClaudeModelDiscovery', () => {
  it('returns the engine roster and never sends a user message', async () => {
    mockQuery.mockImplementation(
      fakeQuery(async () => ({
        models: [
          OPUS_ROW,
          // An ALIAS row resolving to the same model — canonicalized away.
          { value: 'opus', resolvedModel: 'claude-opus-4-8', displayName: 'Opus', description: '' },
        ],
      })),
    )

    const models = await runClaudeModelDiscovery(BASE)
    expect(models).toEqual([
      {
        id: 'claude-opus-4-8',
        label: 'Opus 4.8',
        description: 'Most capable',
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
    ])

    // The prompt is a STREAM that yields nothing: streaming-input mode keeps
    // the session open for the handshake without asking the engine anything.
    const prompt = mockQuery.mock.calls.at(-1)?.[0]?.prompt
    expect(typeof prompt).not.toBe('string')
    const first = await (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]().next()
    expect(first.done).toBe(true)
  })

  it('runs toolless, single-turn, and writes no session JSONL', async () => {
    mockQuery.mockImplementation(fakeQuery(async () => ({ models: [OPUS_ROW] })))
    await runClaudeModelDiscovery(BASE)
    const options = mockQuery.mock.calls.at(-1)?.[0]?.options
    expect(options?.maxTurns).toBe(1)
    expect(options?.tools).toEqual([])
    expect(options?.persistSession).toBe(false)
    expect(options?.permissionMode).toBe('bypassPermissions')
  })

  it('aborts the handshake session once the roster is in hand', async () => {
    mockQuery.mockImplementation(fakeQuery(async () => ({ models: [OPUS_ROW] })))
    await runClaudeModelDiscovery(BASE)
    const options = mockQuery.mock.calls.at(-1)?.[0]?.options
    expect(options?.abortController?.signal.aborted).toBe(true)
  })

  it('gives up on a wedged engine within the timeout — the known roster stands', async () => {
    mockQuery.mockImplementation(fakeQuery(() => new Promise(() => undefined)))
    const warn = vi.fn()
    expect(
      await runClaudeModelDiscovery({ ...BASE, timeoutMs: 10, logger: { warn } as never }),
    ).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('a throwing engine (not installed, not logged in) is null, not a crash', async () => {
    mockQuery.mockImplementation(
      fakeQuery(async () => {
        throw new Error('claude: command not found')
      }),
    )
    expect(await runClaudeModelDiscovery(BASE)).toBeNull()
  })

  it('an empty or unusable answer is null — never an empty picker', async () => {
    mockQuery.mockImplementation(fakeQuery(async () => ({ models: [] })))
    expect(await runClaudeModelDiscovery(BASE)).toBeNull()

    // Rows that carry no real `claude-…` wire id map to nothing usable.
    mockQuery.mockImplementation(
      fakeQuery(async () => ({ models: [{ value: 'default', displayName: 'Default' }] })),
    )
    expect(await runClaudeModelDiscovery(BASE)).toBeNull()
  })
})

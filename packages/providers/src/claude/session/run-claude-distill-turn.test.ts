// Tests for `runClaudeDistillTurn` — THE walls of every ephemeral distill,
// pinned once here (callers' tests pin their prompts and pass-throughs). The
// SDK `query()` is the shared fake.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { runClaudeDistillTurn } from './run-claude-distill-turn.js'
import {
  FAKE_CLAUDE_SESSION_ID,
  createFakeClaudeQuery,
  fakeSystemInitStep,
  type FakeClaudeQueryStep,
} from '../../test-support/fake-claude-query.js'

const mockQuery = vi.mocked(query)

const BASE = {
  prompt: 'Distill this.',
  workspacePath: '/work/demo',
  failureLogMessage: 'distill failed',
}

function resultStep(result: string): FakeClaudeQueryStep {
  return {
    kind: 'emit',
    message: { type: 'result', subtype: 'success', session_id: FAKE_CLAUDE_SESSION_ID, result, usage: {} },
  }
}

describe('runClaudeDistillTurn', () => {
  it('enforces every wall: single turn, TRULY toolless, no session write, bypass', async () => {
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep('ok')]))

    expect(await runClaudeDistillTurn(BASE)).toBe('ok')
    const options = mockQuery.mock.calls.at(-1)?.[0]?.options
    expect(options?.maxTurns).toBe(1)
    // The kill-switch, NOT an empty allow-list (which means "no restriction").
    expect(options?.tools).toEqual([])
    expect(options?.persistSession).toBe(false)
    expect(options?.permissionMode).toBe('bypassPermissions')
    // Fresh by default — no resume unless asked.
    expect(options?.resume).toBeUndefined()
  })

  it('threads resume + model through for a session-covering distill', async () => {
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep('ok')]))
    await runClaudeDistillTurn({
      ...BASE,
      resumeSessionId: 'sess-9',
      model: 'claude-haiku-4-5',
    })
    const options = mockQuery.mock.calls.at(-1)?.[0]?.options
    expect(options?.resume).toBe('sess-9')
    expect(options?.model).toBe('claude-haiku-4-5')
  })

  it('returns null on an empty result', async () => {
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep('')]))
    expect(await runClaudeDistillTurn(BASE)).toBeNull()
  })

  it('returns null and logs the caller context line when the dispatch throws', async () => {
    const warnings: Array<{ payload: object; message: string | undefined }> = []
    mockQuery.mockImplementation(() => {
      throw new Error('boom')
    })

    const result = await runClaudeDistillTurn({
      ...BASE,
      logger: { info: () => {}, warn: (payload, message) => warnings.push({ payload, message }) },
    })

    expect(result).toBeNull()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toBe('distill failed')
  })
})

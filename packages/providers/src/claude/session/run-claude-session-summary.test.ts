// Tests for `runClaudeSessionSummary` — resumes a session, dispatches one
// summarization turn, returns the result text. The SDK `query()` is the shared
// fake.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { runClaudeSessionSummary } from './run-claude-session-summary.js'
import {
  FAKE_CLAUDE_SESSION_ID,
  createFakeClaudeQuery,
  fakeSystemInitStep,
  type FakeClaudeQueryStep,
} from '../../test-support/fake-claude-query.js'
import type { SummarizeSessionInput } from '../../shared/summarize-session-input.js'

const mockQuery = vi.mocked(query)

const BASE: SummarizeSessionInput = {
  workspacePath: '/work/demo',
  resumeSessionId: 'sess-7',
  permissionMode: 'bypass-with-behavior-gate',
  allowedToolNames: [],
  deniedToolNames: [],
}

function resultStep(result: string): FakeClaudeQueryStep {
  return {
    kind: 'emit',
    message: { type: 'result', subtype: 'success', session_id: FAKE_CLAUDE_SESSION_ID, result, usage: {} },
  }
}

describe('runClaudeSessionSummary', () => {
  it('returns the summary text from the result message and resumes the session read-only', async () => {
    const summary = 'GOAL: ship the swap.\nDONE: foundation.\nNEXT: wire the trigger.'
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep(summary)]))

    expect(await runClaudeSessionSummary(BASE)).toBe(summary)
    const queryArg = mockQuery.mock.calls.at(-1)?.[0]
    // Resumes the target session, ephemeral (no JSONL write), single turn.
    expect(queryArg?.options?.resume).toBe('sess-7')
    expect(queryArg?.options?.persistSession).toBe(false)
    expect(queryArg?.options?.maxTurns).toBe(1)
    // TRULY toolless — a summary turn under bypass must not reach tools.
    expect(queryArg?.options?.tools).toEqual([])
  })

  it('returns null when the summary is empty', async () => {
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep('')]))
    expect(await runClaudeSessionSummary(BASE)).toBeNull()
  })

  it('returns null and logs when the dispatch throws', async () => {
    const warnings: Array<{ payload: object; message: string | undefined }> = []
    mockQuery.mockImplementation(() => {
      throw new Error('boom')
    })

    const result = await runClaudeSessionSummary({
      ...BASE,
      logger: { info: () => {}, warn: (payload, message) => warnings.push({ payload, message }) },
    })

    expect(result).toBeNull()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('summarize')
  })
})

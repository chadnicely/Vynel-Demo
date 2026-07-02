// Tests for `runClaudeContextReport` — dispatches `/context` and returns the
// result-message markdown. The SDK `query()` is the shared fake.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { runClaudeContextReport } from './run-claude-context-report.js'
import {
  FAKE_CLAUDE_SESSION_ID,
  createFakeClaudeQuery,
  fakeSystemInitStep,
  type FakeClaudeQueryStep,
} from '../../test-support/fake-claude-query.js'
import type { GetContextReportInput } from '../../shared/get-context-report-input.js'

const mockQuery = vi.mocked(query)

const BASE: GetContextReportInput = {
  workspacePath: '/work/demo',
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

describe('runClaudeContextReport', () => {
  it('returns the /context markdown from the result message', async () => {
    const markdown = '## Context Usage\n\n| Category | Tokens | % |\n|---|---|---|\n| Messages | 8 | 0.0% |'
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep(markdown)]))

    expect(await runClaudeContextReport(BASE)).toBe(markdown)
    // The dispatch is read-only — it must not persist to the session JSONL.
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ persistSession: false }) }),
    )
  })

  it('returns null when the result carries no text', async () => {
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep('')]))

    expect(await runClaudeContextReport(BASE)).toBeNull()
  })

  it('returns null and logs when the dispatch throws', async () => {
    const warnings: Array<{ payload: object; message: string | undefined }> = []
    mockQuery.mockImplementation(() => {
      throw new Error('boom')
    })

    const report = await runClaudeContextReport({
      ...BASE,
      logger: { info: () => {}, warn: (payload, message) => warnings.push({ payload, message }) },
    })

    expect(report).toBeNull()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('/context')
  })
})

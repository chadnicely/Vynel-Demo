// Tests for `runClaudeReportSummary` — one fresh ephemeral distill turn over
// the report text, returning the user-facing reply. The SDK `query()` is the
// shared fake.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { runClaudeReportSummary } from './run-claude-report-summary.js'
import {
  FAKE_CLAUDE_SESSION_ID,
  createFakeClaudeQuery,
  fakeSystemInitStep,
  type FakeClaudeQueryStep,
} from '../../test-support/fake-claude-query.js'
import type { SummarizeReportInput } from '../../shared/summarize-report-input.js'

const mockQuery = vi.mocked(query)

const BASE: SummarizeReportInput = {
  workspacePath: '/work/demo',
  taskText: 'audit the pricing page',
  reportText: 'I audited the pricing page. Found 3 issues: … (long detail) …',
  workspaceName: 'Acme Site',
  deliveryTarget: 'chat',
}

function resultStep(result: string): FakeClaudeQueryStep {
  return {
    kind: 'emit',
    message: { type: 'result', subtype: 'success', session_id: FAKE_CLAUDE_SESSION_ID, result, usage: {} },
  }
}

describe('runClaudeReportSummary', () => {
  it('returns the reply text; dispatches fresh, ephemeral, single-turn, on the cheap model', async () => {
    const reply = 'Done — audited the pricing page and found 3 issues, all minor.'
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep(reply)]))

    expect(await runClaudeReportSummary(BASE)).toBe(reply)
    const queryArg = mockQuery.mock.calls.at(-1)?.[0]
    // Fresh (no resume), ephemeral (no JSONL write), single turn, cheap model.
    expect(queryArg?.options?.resume).toBeUndefined()
    expect(queryArg?.options?.persistSession).toBe(false)
    expect(queryArg?.options?.maxTurns).toBe(1)
    expect(queryArg?.options?.model).toBe('claude-haiku-4-5')
    // TRULY toolless — the report text is delegate-produced; a tool-capable
    // bypass turn would be an injection egress channel.
    expect(queryArg?.options?.tools).toEqual([])
    // The task + report ride the prompt; the manager's voice is set up.
    const prompt = queryArg?.prompt as string
    expect(prompt).toContain('audit the pricing page')
    expect(prompt).toContain(BASE.reportText)
    expect(prompt).toContain('Acme Site')
  })

  it('formats for the delivery target (telegram gets the plain-text rule)', async () => {
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep('ok')]))
    await runClaudeReportSummary({ ...BASE, deliveryTarget: 'telegram' })
    const prompt = mockQuery.mock.calls.at(-1)?.[0]?.prompt as string
    expect(prompt).toContain('Telegram')
    expect(prompt).not.toContain('Discord')
  })

  it('an explicit model overrides the cheap default', async () => {
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep('ok')]))
    await runClaudeReportSummary({ ...BASE, model: 'claude-sonnet-5' })
    expect(mockQuery.mock.calls.at(-1)?.[0]?.options?.model).toBe('claude-sonnet-5')
  })

  it('returns null when the reply is empty', async () => {
    mockQuery.mockImplementation(createFakeClaudeQuery([fakeSystemInitStep(), resultStep('')]))
    expect(await runClaudeReportSummary(BASE)).toBeNull()
  })

  it('returns null and logs when the dispatch throws', async () => {
    const warnings: Array<{ payload: object; message: string | undefined }> = []
    mockQuery.mockImplementation(() => {
      throw new Error('boom')
    })

    const result = await runClaudeReportSummary({
      ...BASE,
      logger: { info: () => {}, warn: (payload, message) => warnings.push({ payload, message }) },
    })

    expect(result).toBeNull()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('distill')
  })
})

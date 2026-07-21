// Unit tests for the routed-turn provider-input home — the steer selection
// (task default vs the report-delivery variant, session-comms) and the joined
// per-feature prompt sections. Pure functions, no DB.

import { describe, expect, it } from 'vitest'
import {
  composeRoutedTurnSystemPrompt,
  ROUTED_TASK_INSTRUCTIONS,
  REPORT_DELIVERY_INSTRUCTIONS,
  type RoutedTurnMcpAttachment,
} from './routed-turn-provider-input.js'

const attachmentWithPrompt: RoutedTurnMcpAttachment = {
  mcpServers: {},
  allowedMcpToolPatterns: [],
  deniedMcpToolPatterns: [],
  mutatingToolNames: [],
  systemPromptAppend: '## Task list\nkeep it current',
}

describe('composeRoutedTurnSystemPrompt', () => {
  it('defaults to the TASK steer — no attachment and empty-prompt attachment alike (the shipped shape, byte-for-byte)', () => {
    expect(composeRoutedTurnSystemPrompt(undefined)).toBe(ROUTED_TASK_INSTRUCTIONS)
    expect(
      composeRoutedTurnSystemPrompt({ ...attachmentWithPrompt, systemPromptAppend: '' }),
    ).toBe(ROUTED_TASK_INSTRUCTIONS)
  })

  it('joins the attachment prompt sections under whichever steer is active', () => {
    expect(composeRoutedTurnSystemPrompt(attachmentWithPrompt)).toBe(
      `${ROUTED_TASK_INSTRUCTIONS}\n\n## Task list\nkeep it current`,
    )
    expect(
      composeRoutedTurnSystemPrompt(attachmentWithPrompt, REPORT_DELIVERY_INSTRUCTIONS),
    ).toBe(`${REPORT_DELIVERY_INSTRUCTIONS}\n\n## Task list\nkeep it current`)
  })

  it('the report-delivery steer REPLACES the task steer — never both, never re-run language on a task', () => {
    const reportPrompt = composeRoutedTurnSystemPrompt(undefined, REPORT_DELIVERY_INSTRUCTIONS)
    expect(reportPrompt).toBe(REPORT_DELIVERY_INSTRUCTIONS)
    expect(reportPrompt).not.toContain('This task was routed')
    expect(ROUTED_TASK_INSTRUCTIONS).not.toContain('REPORT from a session')
  })
})

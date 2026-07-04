import { describe, it, expect } from 'vitest'
import { summarizeApprovalForChannel } from './summarize-approval-for-channel.js'
import type { ChatTurnEvent } from '@vynel/contracts/chat/chat-http'

type ApprovalRequestedEvent = Extract<ChatTurnEvent, { kind: 'approval-requested' }>

function ev(overrides: Partial<ApprovalRequestedEvent> = {}): ApprovalRequestedEvent {
  return {
    kind: 'approval-requested',
    approvalRequestId: 'r1',
    parentMessageId: 'p',
    toolName: 'Bash',
    toolInput: { command: 'ls' },
    requestedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('summarizeApprovalForChannel', () => {
  it('includes the tool name, an input preview, and the reply hint', () => {
    const summary = summarizeApprovalForChannel(ev())
    expect(summary).toContain('Bash')
    expect(summary).toContain('ls')
    expect(summary.toLowerCase()).toContain('approve')
  })

  it('truncates a very long tool input', () => {
    const summary = summarizeApprovalForChannel(ev({ toolInput: { blob: 'a'.repeat(500) } }))
    expect(summary).toContain('…')
  })

  it('handles a null tool input without throwing', () => {
    const summary = summarizeApprovalForChannel(ev({ toolInput: null }))
    expect(summary).toContain('Bash')
  })
})

import { describe, it, expect } from 'vitest'
import type { ChatTurnEvent } from '@vynel/chat'
import type { ChatToolCall } from '@vynel/chat'
import { turnStepFromChatTurnEvent, publishTurnActivityStep } from './activity-turn-steps.js'
import type { SessionTurnActivityHandle } from './session-activity-feed.js'
import type { SessionTurnStep } from '@vynel/contracts/chat/session-activity'

function toolCall(overrides: Partial<ChatToolCall> = {}): ChatToolCall {
  return {
    id: 'tc-1',
    parentMessageId: 'msg-1',
    toolUseId: 'toolu_1',
    toolName: 'mcp__desktop__snapshot_app',
    toolInput: { app: 'Discord' },
    toolOutput: null,
    status: 'started',
    approvalStatus: null,
    isErrorResult: false,
    subagentNarrative: null,
    subagentToolCalls: null,
    startedAt: new Date('2026-07-21T10:00:00Z'),
    completedAt: null,
    ...overrides,
  } as ChatToolCall
}

describe('turnStepFromChatTurnEvent', () => {
  it('maps tool-call-started with its (small) input', () => {
    const step = turnStepFromChatTurnEvent({ kind: 'tool-call-started', toolCall: toolCall() })
    expect(step).toEqual({
      kind: 'turn-tool-started',
      toolUseId: 'toolu_1',
      toolName: 'mcp__desktop__snapshot_app',
      toolInput: { app: 'Discord' },
    })
  })

  it('drops a large tool input but keeps the step', () => {
    const step = turnStepFromChatTurnEvent({
      kind: 'tool-call-started',
      toolCall: toolCall({ toolInput: { blob: 'x'.repeat(5000) } }),
    })
    expect(step).toMatchObject({ kind: 'turn-tool-started', toolUseId: 'toolu_1' })
    expect(step).not.toHaveProperty('toolInput')
  })

  it('maps tool-call-completed to a settled step with the terminal status', () => {
    const step = turnStepFromChatTurnEvent({
      kind: 'tool-call-completed',
      toolCall: toolCall({ status: 'denied' }),
    })
    expect(step).toEqual({ kind: 'turn-tool-settled', toolUseId: 'toolu_1', status: 'denied' })
  })

  it('maps approval-requested/resolved/auto-resolved to bells (no state)', () => {
    expect(
      turnStepFromChatTurnEvent({
        kind: 'approval-requested',
        approvalRequestId: 'ap-1',
        parentMessageId: 'msg-1',
        toolName: 'mcp__desktop__act_on_app',
        toolInput: {},
        requestedAt: new Date(),
      }),
    ).toEqual({
      kind: 'turn-approval-requested',
      approvalRequestId: 'ap-1',
      toolName: 'mcp__desktop__act_on_app',
    })
    expect(
      turnStepFromChatTurnEvent({
        kind: 'approval-auto-resolved',
        approvalRequestId: 'ap-1',
        parentMessageId: 'msg-1',
        matchedRuleId: 'rule-1',
        resolvedAt: new Date(),
      }),
    ).toEqual({ kind: 'turn-approval-resolved', approvalRequestId: 'ap-1' })
  })

  it('everything else is not a step (chunks, lifecycle, usage)', () => {
    const nonSteps: ChatTurnEvent[] = [
      { kind: 'text-chunk', messageId: 'm', textDelta: 'hi' },
      { kind: 'thinking-chunk', messageId: 'm', thinkingDelta: 'hm' },
      { kind: 'session-completed', sessionId: 's' },
      {
        kind: 'usage-reported',
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    ]
    for (const event of nonSteps) {
      expect(turnStepFromChatTurnEvent(event)).toBeNull()
    }
  })
})

describe('publishTurnActivityStep', () => {
  it('publishes mapped steps through the handle and skips non-steps', () => {
    const published: SessionTurnStep[] = []
    const handle: SessionTurnActivityHandle = {
      turnId: 't-1',
      sessionResolved: () => {},
      publishTurnStep: (step) => published.push(step),
      end: () => {},
    }
    publishTurnActivityStep(handle, { kind: 'tool-call-started', toolCall: toolCall() })
    publishTurnActivityStep(handle, { kind: 'text-chunk', messageId: 'm', textDelta: 'x' })
    expect(published).toHaveLength(1)
    expect(published[0]?.kind).toBe('turn-tool-started')
  })
})

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
      toolCall: toolCall({ toolName: 'Read', toolInput: { blob: 'x'.repeat(5000) } }),
    })
    expect(step).toMatchObject({ kind: 'turn-tool-started', toolUseId: 'toolu_1' })
    expect(step).not.toHaveProperty('toolInput')
  })

  it('keeps a MAXIMUM-SIZE desktop plan — its input IS the safety surface', () => {
    // A maximum legal plan is ~6KB (goal 500 + 20 steps x 200 + 10 apps x 120).
    // Under the general 2KB bound the overlay would silently show "Claude is
    // looking at your desktop" with a blank plan panel while an APPROVED plan
    // drove the machine — the exact failure the overlay exists to prevent.
    const maxPlan = {
      goal: 'g'.repeat(500),
      steps: Array.from({ length: 20 }, () => 's'.repeat(200)),
      apps: Array.from({ length: 10 }, () => ({ app: 'a'.repeat(120), tier: 'full' })),
    }
    expect(JSON.stringify(maxPlan).length).toBeGreaterThan(2048)
    const step = turnStepFromChatTurnEvent({
      kind: 'tool-call-started',
      toolCall: toolCall({
        toolName: 'mcp__desktop__propose_desktop_plan',
        toolInput: maxPlan,
      }),
    })
    expect(step).toHaveProperty('toolInput', maxPlan)
  })

  it('still bounds a desktop input that is genuinely huge', () => {
    const step = turnStepFromChatTurnEvent({
      kind: 'tool-call-started',
      toolCall: toolCall({
        toolName: 'mcp__desktop__act_on_app',
        toolInput: { value: 'x'.repeat(20_000) },
      }),
    })
    expect(step).toMatchObject({ kind: 'turn-tool-started' })
    expect(step).not.toHaveProperty('toolInput')
  })

  it('maps tool-call-completed to a settled step with the terminal status', () => {
    const step = turnStepFromChatTurnEvent({
      kind: 'tool-call-completed',
      toolCall: toolCall({ status: 'denied' }),
    })
    expect(step).toEqual({ kind: 'turn-tool-settled', toolUseId: 'toolu_1', status: 'denied' })
  })

  it("carries a BLOCKED settle (the provider's own safety check refused the call) verbatim", () => {
    const step = turnStepFromChatTurnEvent({
      kind: 'tool-call-completed',
      toolCall: toolCall({ status: 'blocked', isErrorResult: true }),
    })
    expect(step).toEqual({ kind: 'turn-tool-settled', toolUseId: 'toolu_1', status: 'blocked' })
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

  it('narrates the visible swap: context-patching / context-patched map to feed steps', () => {
    expect(
      turnStepFromChatTurnEvent({ kind: 'context-patching', sessionId: 'seg-a', primarySessionId: 'p-1' }),
    ).toEqual({ kind: 'turn-context-patching', fromSessionId: 'seg-a' })
    expect(
      turnStepFromChatTurnEvent({ kind: 'context-patched', sessionId: 'seg-a', primarySessionId: 'p-1', toSessionId: 'seg-b' }),
    ).toEqual({ kind: 'turn-context-patched', fromSessionId: 'seg-a', toSessionId: 'seg-b' })
    // A swap that aborted still settles the step — the conversation stayed.
    expect(
      turnStepFromChatTurnEvent({ kind: 'context-patched', sessionId: 'seg-a', primarySessionId: 'p-1', toSessionId: null }),
    ).toEqual({ kind: 'turn-context-patched', fromSessionId: 'seg-a', toSessionId: null })
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

  describe('subagent DESKTOP work still narrates', () => {
    // A subagent's tool calls normally stay nested under its Agent card. Desktop
    // tools are the exception: the attention overlay is a safety surface, so a
    // delegated desktop task must never drive the machine behind a dark overlay.
    const agentStarted = (toolName: string): ChatTurnEvent => ({
      kind: 'agent-tool-started',
      parentToolUseId: 'toolu_parent',
      toolUseId: 'toolu_child',
      toolName,
      toolInput: { app: 'Discord' },
      startedAt: new Date('2026-08-11T10:00:00Z'),
    })
    const agentCompleted = (toolName: string | null, isError = false): ChatTurnEvent => ({
      kind: 'agent-tool-completed',
      parentToolUseId: 'toolu_parent',
      toolUseId: 'toolu_child',
      toolName,
      toolOutput: 'ok',
      isError,
      completedAt: new Date('2026-08-11T10:00:01Z'),
    })

    it('surfaces a subagent desktop step as a turn step', () => {
      expect(turnStepFromChatTurnEvent(agentStarted('mcp__desktop__act_on_app'))).toEqual({
        kind: 'turn-tool-started',
        toolUseId: 'toolu_child',
        toolName: 'mcp__desktop__act_on_app',
        toolInput: { app: 'Discord' },
      })
      expect(turnStepFromChatTurnEvent(agentCompleted('mcp__desktop__act_on_app'))).toEqual({
        kind: 'turn-tool-settled',
        toolUseId: 'toolu_child',
        status: 'completed',
      })
      expect(turnStepFromChatTurnEvent(agentCompleted('mcp__desktop__act_on_app', true))).toEqual({
        kind: 'turn-tool-settled',
        toolUseId: 'toolu_child',
        status: 'failed',
      })
    })

    it('leaves every OTHER subagent tool nested (the feed is not a subagent log)', () => {
      expect(turnStepFromChatTurnEvent(agentStarted('Read'))).toBeNull()
      expect(turnStepFromChatTurnEvent(agentStarted('mcp__vynel__list_workspaces'))).toBeNull()
      expect(turnStepFromChatTurnEvent(agentCompleted('Read'))).toBeNull()
      // An unnamed completion (its start was never recorded) settles nothing.
      expect(turnStepFromChatTurnEvent(agentCompleted(null))).toBeNull()
    })
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

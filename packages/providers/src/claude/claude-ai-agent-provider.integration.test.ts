// Mock-SDK integration test for `ClaudeAiAgentProvider` — exercises the class's
// public surface (`startChatSession` / `respondToApprovalRequest` /
// `interruptChatSession`) with the shared fake-query helper. The DB is never
// mocked; the SDK may be (an external surface).
// See `docs/blueprints/providers/blueprint.md §17.7`.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { NotFoundError } from '@vynel/errors'
import { ClaudeAiAgentProvider } from './claude-ai-agent-provider.js'
import {
  createFakeClaudeQuery,
  fakeAssistantMessageStep,
  fakeSuccessResultStep,
  fakeSystemInitStep,
  fakeTextStreamStep,
  type FakeClaudeQueryStep,
} from '../test-support/fake-claude-query.js'
import { FAKE_CLAUDE_SESSION_ID } from '../test-support/fake-claude-query.js'
import type { NormalizedSessionEvent } from '../shared/normalized-session-event.js'
import type { StartChatSessionInput } from '../shared/start-chat-session-input.js'

const mockQuery = vi.mocked(query)

const BASE_INPUT: StartChatSessionInput = {
  workspacePath: '/work/demo',
  userMessageText: 'hello',
  permissionMode: 'ask',
  allowedToolNames: [],
  deniedToolNames: [],
}

function installFakeQuery(script: FakeClaudeQueryStep[]): void {
  mockQuery.mockImplementation(createFakeClaudeQuery(script))
}

describe('ClaudeAiAgentProvider (integration)', () => {
  it('startChatSession emits session-started -> text-chunk -> session-completed', async () => {
    installFakeQuery([
      fakeSystemInitStep(),
      fakeTextStreamStep('Hi.'),
      fakeAssistantMessageStep({ text: 'Hi.' }),
      fakeSuccessResultStep(),
    ])
    const provider = new ClaudeAiAgentProvider()

    const events: NormalizedSessionEvent[] = []
    for await (const event of provider.startChatSession(BASE_INPUT)) events.push(event)

    expect(events.map((event) => event.kind)).toEqual([
      'session-started',
      'text-chunk',
      'usage-reported',
      'session-completed',
    ])
  })

  it('respondToApprovalRequest throws NotFoundError for an unknown request id', async () => {
    const provider = new ClaudeAiAgentProvider()
    await expect(
      provider.respondToApprovalRequest('unknown-request-id', { kind: 'approved' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('a tool requiring approval pauses until respondToApprovalRequest resolves it', async () => {
    installFakeQuery([
      fakeSystemInitStep(),
      { kind: 'toolUse', toolName: 'Bash', toolInput: { command: 'ls' } },
      fakeSuccessResultStep(),
    ])
    const provider = new ClaudeAiAgentProvider()

    const events: NormalizedSessionEvent[] = []
    for await (const event of provider.startChatSession(BASE_INPUT)) {
      events.push(event)
      if (event.kind === 'approval-requested') {
        await provider.respondToApprovalRequest(event.approvalRequestId, { kind: 'approved' })
      }
    }

    const kinds = events.map((event) => event.kind)
    expect(kinds).toContain('approval-requested')
    expect(kinds).toContain('approval-resolved')
    expect(kinds.at(-1)).toBe('session-completed')
  })

  it('interruptChatSession emits session-interrupted for a running session', async () => {
    installFakeQuery([fakeSystemInitStep(), fakeTextStreamStep('one'), fakeTextStreamStep('two')])
    const provider = new ClaudeAiAgentProvider()
    const iterator = provider.startChatSession(BASE_INPUT)[Symbol.asyncIterator]()

    const firstEvent = await iterator.next()
    expect(firstEvent.value).toMatchObject({ kind: 'session-started' })
    await provider.interruptChatSession(FAKE_CLAUDE_SESSION_ID)

    const remaining: NormalizedSessionEvent[] = []
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      remaining.push(next.value)
    }
    expect(remaining.at(-1)?.kind).toBe('session-interrupted')
  })

  it('cleanup-on-abandon: a pending approval is cancelled when the consumer stops iterating', async () => {
    installFakeQuery([
      fakeSystemInitStep(),
      { kind: 'toolUse', toolName: 'Bash', toolInput: { command: 'ls' } },
      fakeSuccessResultStep(),
    ])
    const provider = new ClaudeAiAgentProvider()
    const iterator = provider.startChatSession(BASE_INPUT)[Symbol.asyncIterator]()

    let pendingApprovalRequestId = ''
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      if (next.value.kind === 'approval-requested') {
        pendingApprovalRequestId = next.value.approvalRequestId
        break
      }
    }
    expect(pendingApprovalRequestId).not.toBe('')

    await iterator.return?.(undefined) // abandon — the runner's finally cancels pending approvals

    await expect(
      provider.respondToApprovalRequest(pendingApprovalRequestId, { kind: 'approved' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

// The asking scope — which of the turn's two session ids lands on the row,
// and WHEN it is read. Both halves were the defect: a workspace chat recorded
// no session at all (the value was read at compose time, before the id
// existed), so a conversation parked on `ask_user` never lit as waiting.

import { describe, expect, it } from 'vitest'
import type { SessionToolContext } from '@vynel/mcp-contract'
import { resolveAskScope } from './ask-mcp-feature-descriptor.js'

function context(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return { db: {}, userId: 'user-1', appRequest: () => new Response(), ...overrides }
}

describe('resolveAskScope', () => {
  it('records the CHAT session, not the stable primary', () => {
    const scope = resolveAskScope(
      context({ sessionId: 'primary-1', resolveChatSessionId: () => 'chat-1' }),
    )
    expect(scope.resolveSessionId?.()).toBe('chat-1')
  })

  it('reads the session at CALL time, so a fresh conversation still records one', () => {
    // The carrier's state when the toolset is composed: empty.
    let chatSessionId: string | undefined
    const scope = resolveAskScope(context({ resolveChatSessionId: () => chatSessionId }))
    expect(scope.resolveSessionId?.()).toBeUndefined()

    // The stream's first frame resolves it — a full round trip before the
    // model can call the tool.
    chatSessionId = 'chat-late'
    expect(scope.resolveSessionId?.()).toBe('chat-late')
  })

  it('a global-root turn carries no workspace', () => {
    expect(resolveAskScope(context()).workspaceId).toBeNull()
  })

  it('a turn with no watching conversation resolves nothing', () => {
    expect(resolveAskScope(context()).resolveSessionId).toBeUndefined()
  })
})

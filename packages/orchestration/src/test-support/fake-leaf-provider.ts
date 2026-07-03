// Test-support: a structural fake `AiAgentProvider` for the by-reference leaf
// path (`createLeafSession` / `pushToSession`). Only `startChatSession` is
// exercised by those ops, so the structural cast — mirroring the
// `as unknown as AgentRow` precedent in `map-agent-to-leaf-input.test.ts` — keeps
// the fake tiny and avoids implementing the full abstract surface. Never imported
// by production code.
//
// The yielded stream is a complete leaf turn: `session-started` → `text-chunk`
// (the clean result the root absorbs) → `session-completed`, so `drainLeafTurn`
// captures both the reference (SDK session id) and a non-empty result.

import type {
  AiAgentProvider,
  ApprovalDecision,
  NormalizedSessionEvent,
  StartChatSessionInput,
} from '@vynel/providers'

export type FakeLeafTurn = {
  /** The SDK session id the leaf turn yields (the by-reference handle). */
  sessionId: string
  /** The assistant answer text the leaf streams (the clean result). */
  resultText: string
  /** When set, the leaf stream yields an `approval-requested` for this (carded)
   *  tool BEFORE the text-chunk — exercises the fail-closed auto-deny (C1). */
  approvalToolName?: string
}

/** A captured `respondToApprovalRequest` call — the test asserts the auto-deny. */
export type CapturedApprovalResponse = { requestId: string; decision: ApprovalDecision }

export function makeFakeLeafProvider(
  turn: FakeLeafTurn,
  captured?: StartChatSessionInput[],
  approvalResponses?: CapturedApprovalResponse[],
): AiAgentProvider {
  return {
    startChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
      captured?.push(input)
      async function* events(): AsyncIterable<NormalizedSessionEvent> {
        yield {
          kind: 'session-started',
          sessionId: turn.sessionId,
          resumedFromExisting: input.resumeSessionId !== undefined,
          startedAt: new Date(),
        }
        if (turn.approvalToolName !== undefined) {
          yield {
            kind: 'approval-requested',
            sessionId: turn.sessionId,
            approvalRequestId: 'appr-1',
            parentMessageId: '',
            toolName: turn.approvalToolName,
            toolInput: {},
            requestedAt: new Date(),
          }
        }
        yield {
          kind: 'text-chunk',
          sessionId: turn.sessionId,
          messageId: 'm1',
          textDelta: turn.resultText,
          isFinalChunk: true,
        }
        yield {
          kind: 'session-completed',
          sessionId: turn.sessionId,
          isNewSession: input.resumeSessionId === undefined,
          completedAt: new Date(),
        }
      }
      return events()
    },
    respondToApprovalRequest(requestId: string, decision: ApprovalDecision): Promise<void> {
      approvalResponses?.push({ requestId, decision })
      return Promise.resolve()
    },
  } as unknown as AiAgentProvider
}

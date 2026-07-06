// A configurable fake `AiAgentProvider` for the app-tier delegation tests — lets
// `delegateToWorkspaceRoot` / `delegateToLeafSession` / the claim-and-run tick be
// exercised end-to-end WITHOUT a live SDK. Only the two methods the delegation +
// swap paths use (`startChatSession`, `summarizeSession`) are configurable; every
// other abstract method throws if reached, so a test that accidentally hits one
// fails loudly. Test-support only — never imported by production code. (The
// `@vynel/session` runtime keeps its own private copy; the package does not
// export it — the source-repo apps/api precedent.)

import { AiAgentProvider } from '@vynel/providers'
import type {
  AiAgentProviderId,
  ApprovalDecision,
  NormalizedSessionEvent,
  StartChatSessionInput,
} from '@vynel/providers'

export type FakeAiAgentProviderOptions = {
  /** The session id the next seeded `startChatSession` yields. */
  seededSessionId?: string
  /** The carry `summarizeSession` returns (null aborts the swap). */
  summary?: string | null
  /** Captures every `startChatSession` input the test makes assertions on. */
  startChatSessionInputs?: StartChatSessionInput[]
  /**
   * When set, `startChatSession` yields a `text-chunk` with this body between
   * `session-started` and `session-completed`, so a by-reference leaf drain
   * (`drainLeafTurn`) captures a non-empty result. Unset = the swap-priming
   * shape (no answer text), preserving the existing swap-wiring tests.
   */
  resultText?: string
  /**
   * When set, the stream yields an `approval-requested` for this (carded) tool
   * before the text-chunk and then PARKS — awaiting `respondToApprovalRequest`
   * ('appr-1') — before emitting `approval-resolved` and continuing. Mirrors the
   * real provider's PendingApprovalRegistry, so the surface-up record-and-park
   * path is exercised end-to-end.
   */
  approvalToolName?: string
}

export class FakeAiAgentProvider extends AiAgentProvider {
  readonly providerId: AiAgentProviderId = 'claude'

  // The park: `approval-requested` awaits this promise; `respondToApprovalRequest`
  // resolves it (the real provider's PendingApprovalRegistry shape).
  private resolveApprovalDecision: ((decision: ApprovalDecision) => void) | undefined
  private readonly approvalDecisionArrived = new Promise<ApprovalDecision>((resolve) => {
    this.resolveApprovalDecision = resolve
  })

  constructor(private readonly options: FakeAiAgentProviderOptions = {}) {
    super()
  }

  startChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
    this.options.startChatSessionInputs?.push(input)
    const sessionId = this.options.seededSessionId ?? 'sdk-seeded'
    const { resultText, approvalToolName } = this.options
    const decisionArrived = this.approvalDecisionArrived
    // Unique per turn — the real SDK mints fresh message ids; a reused id would
    // make the shared consumer append a second turn's chunks to the first's row.
    const messageId = `m-${crypto.randomUUID()}`
    async function* events(): AsyncIterable<NormalizedSessionEvent> {
      yield {
        kind: 'session-started',
        sessionId,
        resumedFromExisting: input.resumeSessionId !== undefined,
        startedAt: new Date(),
      }
      if (approvalToolName !== undefined) {
        yield {
          kind: 'approval-requested',
          sessionId,
          approvalRequestId: 'appr-1',
          parentMessageId: 'msg-1',
          toolName: approvalToolName,
          toolInput: {},
          requestedAt: new Date(),
        }
        const decision = await decisionArrived // parked until someone decides
        yield {
          kind: 'approval-resolved',
          sessionId,
          approvalRequestId: 'appr-1',
          decision,
          resolvedAt: new Date(),
        }
      }
      if (resultText !== undefined) {
        yield {
          kind: 'text-chunk',
          sessionId,
          messageId,
          textDelta: resultText,
          isFinalChunk: true,
        }
      }
      yield { kind: 'session-completed', sessionId, isNewSession: true, completedAt: new Date() }
    }
    return events()
  }

  // Param omitted — a narrower override is assignable; the swap path only needs
  // the configured carry back (the real distill is a live SDK read).
  override summarizeSession(): Promise<string | null> {
    return Promise.resolve(this.options.summary ?? null)
  }

  getAuthenticationStatus(): never {
    throw new Error('FakeAiAgentProvider.getAuthenticationStatus not implemented')
  }
  discoverInstalledSkills(): never {
    throw new Error('FakeAiAgentProvider.discoverInstalledSkills not implemented')
  }
  listConfiguredMcpServers(): never {
    throw new Error('FakeAiAgentProvider.listConfiguredMcpServers not implemented')
  }
  respondToApprovalRequest(_requestId: string, decision: ApprovalDecision): Promise<void> {
    this.resolveApprovalDecision?.(decision)
    return Promise.resolve()
  }
  interruptChatSession(): never {
    throw new Error('FakeAiAgentProvider.interruptChatSession not implemented')
  }
  fetchPersistedSessionTranscript(): never {
    throw new Error('FakeAiAgentProvider.fetchPersistedSessionTranscript not implemented')
  }
  synchronizePersistedSessions(): never {
    throw new Error('FakeAiAgentProvider.synchronizePersistedSessions not implemented')
  }
}

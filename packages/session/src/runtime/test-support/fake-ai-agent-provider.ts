// A configurable fake `AiAgentProvider` shared by this package's swap-wiring AND
// delegation tests — lets `runSeededSwapSession`, `delegateToWorkspaceRoot`,
// `delegateToLeafSession` and the claim-and-run tick be exercised end-to-end
// WITHOUT a live SDK. Only the methods those paths use (`startChatSession`,
// `summarizeSession`, the approval park/resolve pair) are configurable; every
// other abstract method throws if reached, so a test that accidentally hits one
// fails loudly. Test-support only — package-internal, never exported, never
// imported by production code.

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
  /** Captures every `summarizeSession` input the test makes assertions on. */
  summarizeSessionInputs?: SummarizeSessionCall[]
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
  /**
   * When set, the stream yields a `tool-use-started` + `tool-use-completed`
   * pair for this tool before the text-chunk — so a test can assert what a turn
   * NARRATES, not just what it returns. Added for the desktop-autopilot arc:
   * a spawned session driving the desktop must surface its steps on the
   * activity feed the attention overlay folds.
   */
  toolCallName?: string
  /** The distilled reply `summarizeReport` returns (unset/null = not supported
   *  — the tick falls open to the full report). */
  reportReply?: string | null
  /** Captures every `summarizeReport` input the test makes assertions on. */
  summarizeReportInputs?: SummarizeReportCall[]
}

/** The distill's input, derived from the abstract method so it can never
 *  drift (`SummarizeReportInput` itself is barrel-omitted, like its
 *  summarize-session sibling). */
export type SummarizeReportCall = Parameters<AiAgentProvider['summarizeReport']>[0]
/** Same derivation for the swap-carry distill's input. */
export type SummarizeSessionCall = Parameters<AiAgentProvider['summarizeSession']>[0]

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
    const { resultText, approvalToolName, toolCallName } = this.options
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
      if (toolCallName !== undefined) {
        const toolUseId = `tu-${crypto.randomUUID()}`
        yield {
          kind: 'tool-use-started',
          sessionId,
          parentMessageId: messageId,
          toolUseId,
          toolName: toolCallName,
          toolInput: {},
          startedAt: new Date(),
        }
        yield {
          kind: 'tool-use-completed',
          sessionId,
          parentMessageId: messageId,
          toolUseId,
          output: 'ok',
          isError: false,
          completedAt: new Date(),
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

  override summarizeSession(input: SummarizeSessionCall): Promise<string | null> {
    this.options.summarizeSessionInputs?.push(input)
    return Promise.resolve(this.options.summary ?? null)
  }

  override summarizeReport(input: SummarizeReportCall): Promise<string | null> {
    this.options.summarizeReportInputs?.push(input)
    return Promise.resolve(this.options.reportReply ?? null)
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
  /** Records instead of throwing: interrupt is a real path now (a drain that
   *  hits its deadline cancels the turn), so a test asserts WHAT was interrupted. */
  readonly interruptedSessionIds: string[] = []
  interruptChatSession(sessionId: string): Promise<void> {
    this.interruptedSessionIds.push(sessionId)
    return Promise.resolve()
  }
  fetchPersistedSessionTranscript(): never {
    throw new Error('FakeAiAgentProvider.fetchPersistedSessionTranscript not implemented')
  }
  synchronizePersistedSessions(): never {
    throw new Error('FakeAiAgentProvider.synchronizePersistedSessions not implemented')
  }
}

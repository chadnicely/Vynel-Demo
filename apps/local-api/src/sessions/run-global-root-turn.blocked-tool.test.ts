// VERIFICATION suite (channels fix arc, agent B) — the RUNNER's behaviour when
// the SDK's own classifier refuses a tool. The gap this originally pinned
// ("a Telegram turn dies silently") was CLOSED on 2026-08-22, one layer up:
// `route-as-chat-turn` now ships one honest line when a turn queued no reply
// (`ship-silent-turn-fallback.ts`). These cases still stand, and are what make
// that fix necessary: a block does NOT fail the turn, records NO card, and
// leaves the explanation in chat text the runner never delivers.
//
// THE SCENARIO. The SDK's own auto-mode classifier can refuse a tool outright,
// ahead of `canUseTool`, so no Vynel card is ever recorded. The refusal arrives
// as `system`/`permission_denied` -> `tool-use-blocked`
// (`packages/providers/src/claude/base/translate-claude-system-message.ts`),
// the chat consumer settles the row `blocked`
// (`packages/chat/src/turn-consumption/handle-tool-use-blocked.ts`) and emits a
// `tool-call-completed` frame, and the model receives the SDK's canned "The
// user doesn't want to take this action right now. STOP…" tool_result.
//
// In the desktop app that is fine: the thread renders a blocked card with a
// "Run it anyway" affordance. On a CHANNEL turn the card is on a surface the
// sender is not looking at, AND — as these cases pin — the block does not fail
// the turn, so `route-as-chat-turn`'s `catch` apology never fires.
//
// The fix deliberately did NOT change any of that: failing the turn on a
// top-level block would have thrown away a turn that may have done real work
// first. The route decides instead, on the one honest signal — did this turn
// queue anything for the sender? — and ships the model's own explanation, or
// the fixed line when there is none. So these assertions stay GREEN by design;
// `ship-silent-turn-fallback.test.ts` owns the other half.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { SessionActivityFeed, SessionSink } from '@vynel/session/runtime'

const { coreMock, resolveTargetMock, chatSessionRowMock } = vi.hoisted(() => ({
  coreMock: vi.fn(),
  resolveTargetMock: vi.fn(),
  chatSessionRowMock: vi.fn(),
}))

// The heavy core is mocked so the DRAIN SINK can be driven directly; the pure
// helpers stay real (the same shape `run-global-root-turn.test.ts` uses).
vi.mock('@vynel/session/runtime', async () => {
  const actual = await vi.importActual<typeof import('@vynel/session/runtime')>(
    '@vynel/session/runtime',
  )
  return {
    ...actual,
    runGlobalRootTurnCore: coreMock,
  }
})
// Stub descriptors: a null `build` keeps the composed MCP set empty and the SDK
// out of this test.
vi.mock('@vynel/mcp', () => ({
  vynelRoutingDescriptor: { serverName: 'vynel', build: () => null },
}))
vi.mock('@vynel/instructions', () => ({
  notebookFeatureDescriptor: { serverName: 'vynel-notebook', build: () => null },
}))
vi.mock('@vynel/session/mcp', () => ({
  buildSessionFeatureDescriptor: () => ({
    serverName: 'vynel-session',
    build: () => null,
    mutatingToolNames: [],
  }),
}))
vi.mock('@vynel/orchestration', async () => {
  const actual = await vi.importActual<typeof import('@vynel/orchestration')>('@vynel/orchestration')
  return { ...actual, composeSessionAgents: async () => ({}) }
})
vi.mock('@vynel/capabilities', () => ({
  defaultEnabledCapabilityIds: () => new Set<string>(),
  resolveEffectiveToolPolicies: () => new Map(),
  applyToolPolicyDefaultsToCatalog: (catalog: unknown) => catalog,
}))
// Not the seam under test (see resolve-desktop-actions-enabled.test.ts).
vi.mock('./resolve-desktop-actions-enabled.js', () => ({
  resolveDesktopActionsEnabled: () => false,
}))

vi.mock('./resolve-global-root-conversation.js', () => ({
  resolveGlobalRootConversationTarget: resolveTargetMock,
}))
vi.mock('@vynel/chat/repositories', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findChatSessionById: chatSessionRowMock,
}))

import { runGlobalRootTurn } from './run-global-root-turn.js'

type SinkEvent = Parameters<SessionSink['onEvent']>[0]

function fakeActivityFeed() {
  const handle = {
    turnId: 'turn-1',
    sessionResolved: vi.fn(),
    publishTurnStep: vi.fn(),
    end: vi.fn(),
  }
  return { feed: { begin: vi.fn(() => handle) } as unknown as SessionActivityFeed, handle }
}

function fakeDeps(activityFeed: SessionActivityFeed) {
  return {
    db: {} as unknown as Database,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    appRequest: vi.fn(),
    activityFeed,
  }
}

/** The frame the chat consumer emits for a provider-refused call — a settled
 *  tool-call row with status `blocked`, NOT an error event. */
function blockedToolCallEvent(sessionId: string): SinkEvent {
  return {
    kind: 'tool-call-completed',
    toolCall: {
      id: 'tc-1',
      sessionId,
      toolName: 'Bash',
      status: 'blocked',
      isErrorResult: true,
      toolOutput: 'Blocked by the provider safety check.',
    },
  } as unknown as SinkEvent
}

beforeEach(() => {
  coreMock.mockReset()
  resolveTargetMock.mockReset()
  resolveTargetMock.mockResolvedValue({
    primarySessionId: 'root-primary-1',
    resumeSdkSessionId: null,
    workspacePath: '/tmp/global-root',
  })
  chatSessionRowMock.mockReset()
  chatSessionRowMock.mockReturnValue(null)
})

describe('GAP — the SDK classifier blocking a tool is invisible to a channel turn', () => {
  it("a blocked tool does NOT fail the turn: it drains 'ended' and resolves normally", async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'sess-1' },
      } as SinkEvent)
      await sink.onEvent(blockedToolCallEvent('sess-1'))
      await sink.onEvent({ kind: 'text-chunk', messageId: 'm1', textDelta: 'I was blocked.' })
      await sink.onEnd?.()
    })
    const activity = fakeActivityFeed()

    const result = await runGlobalRootTurn(fakeDeps(activity.feed), {
      userId: 'u1',
      userMessageText: 'ssh in and edit the crontab',
      originChannel: 'telegram',
    })

    // No throw, no failure outcome — `route-as-chat-turn`'s catch (the ONLY
    // place a user-facing apology is enqueued) is never entered.
    expect(result.sessionId).toBe('sess-1')
    expect(activity.handle.end).toHaveBeenCalledWith('ended')
  })

  it('the block produces no approval card — the channel push callback never fires', async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'sess-1' },
      } as SinkEvent)
      await sink.onEvent(blockedToolCallEvent('sess-1'))
      await sink.onEnd?.()
    })
    const onApprovalRequested = vi.fn()

    await runGlobalRootTurn(fakeDeps(fakeActivityFeed().feed), {
      userId: 'u1',
      userMessageText: 'ssh in and edit the crontab',
      originChannel: 'telegram',
      onApprovalRequested,
    })

    // The classifier refused AHEAD of `canUseTool`, so no approval was ever
    // recorded — there is nothing for the channel to push, and nothing the
    // sender could approve from Telegram even if they wanted to.
    expect(onApprovalRequested).not.toHaveBeenCalled()
  })

  it("the model's chat text about the block is drained but NEVER shipped — the channel reply is tool-only", async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'sess-1' },
      } as SinkEvent)
      await sink.onEvent(blockedToolCallEvent('sess-1'))
      await sink.onEvent({
        kind: 'text-chunk',
        messageId: 'm1',
        textDelta: "I couldn't do that — the tool was blocked.",
      })
      await sink.onEnd?.()
    })

    const result = await runGlobalRootTurn(fakeDeps(fakeActivityFeed().feed), {
      userId: 'u1',
      userMessageText: 'ssh in and edit the crontab',
      originChannel: 'telegram',
    })

    // The explanation exists — and `route-as-chat-turn` deliberately drops it
    // (locked 2026-07-27, replies travel only via `reply_to_channel`). Unless
    // the model ALSO calls the reply tool, the sender sees silence.
    expect(result.resultText).toBe("I couldn't do that — the tool was blocked.")
  })

  it('a real stream error DOES fail the turn — the contrast that shows the block is treated as success', async () => {
    coreMock.mockImplementation(async (_deps: unknown, _input: unknown, sink: SessionSink) => {
      await sink.onEvent({
        kind: 'user-message-persisted',
        message: { sessionId: 'sess-1' },
      } as SinkEvent)
      await sink.onEvent({
        kind: 'session-errored',
        sessionId: 'sess-1',
        errorMessage: 'provider exploded',
        isRecoverable: false,
      } as SinkEvent)
      await sink.onEnd?.()
    })
    const activity = fakeActivityFeed()

    await expect(
      runGlobalRootTurn(fakeDeps(activity.feed), {
        userId: 'u1',
        userMessageText: 'hi',
        originChannel: 'telegram',
      }),
    ).rejects.toThrow('provider exploded')
    expect(activity.handle.end).toHaveBeenCalledWith('failed')
  })
})

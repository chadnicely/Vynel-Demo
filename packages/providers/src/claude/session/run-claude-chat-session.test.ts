// Tests for `runClaudeChatSession` — the SDK-wrapping async generator. The
// SDK's `query()` is replaced by the shared fake-query test helper, which
// scripts a message sequence, honours `options.abortController`, and invokes
// `options.canUseTool`. See `docs/blueprints/providers/blueprint.md §11.2`.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { runClaudeChatSession } from './run-claude-chat-session.js'
import { ActiveSessionRegistry } from '../../shared/active-session-registry.js'
import { PendingApprovalRegistry } from '../../shared/pending-approval-registry.js'
import {
  FAKE_CLAUDE_SESSION_ID,
  createFakeClaudeQuery,
  createFakeClaudeQueryControlLog,
  type FakeClaudeQueryControlLog,
  fakeAssistantMessageStep,
  fakeMessageStartStep,
  fakeSuccessResultStep,
  fakeSystemInitStep,
  fakeTextStreamStep,
  type FakeClaudeQueryStep,
} from '../../test-support/fake-claude-query.js'
import type { NormalizedSessionEvent } from '../../shared/normalized-session-event.js'
import type { StartChatSessionInput } from '../../shared/start-chat-session-input.js'

const mockQuery = vi.mocked(query)

function installFakeQuery(
  script: FakeClaudeQueryStep[],
  controlLog: FakeClaudeQueryControlLog = createFakeClaudeQueryControlLog(),
): FakeClaudeQueryControlLog {
  mockQuery.mockImplementation(createFakeClaudeQuery(script, controlLog))
  return controlLog
}

const BASE_INPUT: StartChatSessionInput = {
  workspacePath: '/work/demo',
  userMessageText: 'hello',
  permissionMode: 'ask',
  allowedToolNames: [],
  deniedToolNames: [],
}

function startSession(overrides?: {
  activeSessionRegistry?: ActiveSessionRegistry
  pendingApprovalRegistry?: PendingApprovalRegistry
}): AsyncIterable<NormalizedSessionEvent> {
  return runClaudeChatSession({
    input: BASE_INPUT,
    activeSessionRegistry: overrides?.activeSessionRegistry ?? new ActiveSessionRegistry(),
    pendingApprovalRegistry: overrides?.pendingApprovalRegistry ?? new PendingApprovalRegistry(),
  })
}

async function collect(
  iterable: AsyncIterable<NormalizedSessionEvent>,
): Promise<NormalizedSessionEvent[]> {
  const events: NormalizedSessionEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('runClaudeChatSession', () => {
  it('emits session-started -> translated content -> usage -> session-completed', async () => {
    installFakeQuery([
      fakeSystemInitStep(),
      fakeMessageStartStep(),
      fakeTextStreamStep('Hi there.'),
      fakeAssistantMessageStep({ text: 'Hi there.' }),
      fakeSuccessResultStep(),
    ])
    const events = await collect(startSession())
    expect(events.map((event) => event.kind)).toEqual([
      'session-started',
      'text-chunk',
      'usage-reported',
      'session-completed',
    ])
  })

  // The CLI's non-streaming fallback ("Error streaming, falling back to
  // non-streaming mode"): the complete assistant message arrives with NO
  // stream_event deltas. Its text used to be dropped as "already streamed" —
  // the turn ended clean with the whole reply lost (2026-08-18, a 100s turn
  // whose answer sat only in the CLI transcript).
  it('replays a complete assistant message that streamed no deltas as one final text-chunk (the non-streaming fallback)', async () => {
    installFakeQuery([
      fakeSystemInitStep(),
      fakeAssistantMessageStep({ id: 'msg_fallback', text: "Here's the overview." }),
      fakeSuccessResultStep(),
    ])
    const events = await collect(startSession())
    expect(events.map((event) => event.kind)).toEqual([
      'session-started',
      'text-chunk',
      'usage-reported',
      'session-completed',
    ])
    expect(events[1]).toMatchObject({
      kind: 'text-chunk',
      messageId: 'msg_fallback',
      textDelta: "Here's the overview.",
      isFinalChunk: true,
    })
  })

  it('does not double text that DID stream — a second message that did not still replays', async () => {
    installFakeQuery([
      fakeSystemInitStep(),
      fakeMessageStartStep('msg_streamed'),
      fakeTextStreamStep('streamed '),
      fakeTextStreamStep('text'),
      fakeAssistantMessageStep({ id: 'msg_streamed', text: 'streamed text' }),
      fakeAssistantMessageStep({ id: 'msg_retry', text: 'retried answer' }),
      fakeSuccessResultStep(),
    ])
    const events = await collect(startSession())
    const textChunks = events.filter((event) => event.kind === 'text-chunk')
    expect(textChunks.map((chunk) => (chunk.kind === 'text-chunk' ? chunk.textDelta : ''))).toEqual([
      'streamed ',
      'text',
      'retried answer',
    ])
  })

  it('threads askModeApprovalToolNames end-to-end: the wired PreToolUse hook cards a tier tool in ask mode', async () => {
    // The whole chain is conditional spreads (input → provider → options
    // builder), which excess-property checks cannot police — a typo'd key would
    // silently drop the tier and revert ask mode to uncarded deletes. This pins
    // the seam: the OPTIONS the SDK actually received must card the tool.
    installFakeQuery([fakeSystemInitStep(), fakeSuccessResultStep()])
    await collect(
      runClaudeChatSession({
        input: { ...BASE_INPUT, askModeApprovalToolNames: ['mcp__vynel__remove_knowledge_source'] },
        activeSessionRegistry: new ActiveSessionRegistry(),
        pendingApprovalRegistry: new PendingApprovalRegistry(),
      }),
    )
    const sdkOptions = mockQuery.mock.calls.at(-1)![0].options
    const wiredHook = sdkOptions?.hooks?.PreToolUse?.[0]?.hooks?.[0]
    expect(typeof wiredHook).toBe('function')
    const result = (await wiredHook!(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'mcp__vynel__remove_knowledge_source',
        tool_input: {},
        tool_use_id: 't',
        session_id: 's',
        transcript_path: '',
        cwd: '/work/demo',
      } as never,
      undefined,
      { signal: new AbortController().signal },
    )) as { hookSpecificOutput?: { permissionDecision?: string } }
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask')
  })

  it('registers the session while running and unregisters on completion', async () => {
    installFakeQuery([fakeSystemInitStep(), fakeSuccessResultStep()])
    const activeSessionRegistry = new ActiveSessionRegistry()
    await collect(startSession({ activeSessionRegistry }))
    expect(activeSessionRegistry.listActiveSessionIds()).toEqual([])
  })

  it('emits session-errored when the result message has an error subtype', async () => {
    installFakeQuery([
      fakeSystemInitStep(),
      {
        kind: 'emit',
        message: {
          type: 'result',
          subtype: 'error_max_turns',
          session_id: FAKE_CLAUDE_SESSION_ID,
          errors: ['reached the turn limit'],
        },
      },
    ])
    const events = await collect(startSession())
    const lastEvent = events.at(-1)
    if (lastEvent?.kind !== 'session-errored') throw new Error('expected session-errored')
    expect(lastEvent.errorCode).toBe('error_max_turns')
    expect(lastEvent.errorMessage).toContain('turn limit')
  })

  it('interrupting the session emits session-interrupted and clears the registry', async () => {
    installFakeQuery([fakeSystemInitStep(), fakeTextStreamStep('one'), fakeTextStreamStep('two')])
    const activeSessionRegistry = new ActiveSessionRegistry()
    const iterator = startSession({ activeSessionRegistry })[Symbol.asyncIterator]()

    const firstEvent = await iterator.next()
    expect(firstEvent.value).toMatchObject({ kind: 'session-started' })
    await activeSessionRegistry.interrupt(FAKE_CLAUDE_SESSION_ID)

    const remaining: NormalizedSessionEvent[] = []
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      remaining.push(next.value)
    }
    expect(remaining.at(-1)?.kind).toBe('session-interrupted')
    expect(activeSessionRegistry.listActiveSessionIds()).toEqual([])
  })

  // Chad, 2026-08-25: "it needs to stop IMMEDIATELY, no delay". Aborting alone
  // only unwinds our iteration — a long Bash keeps running inside the CLI
  // until it returns. The CLI's own interrupt reaches it mid-tool.
  it("Stop sends the CLI's own interrupt before aborting", async () => {
    const controlLog = installFakeQuery([
      fakeSystemInitStep(),
      fakeTextStreamStep('one'),
      fakeTextStreamStep('two'),
    ])
    const activeSessionRegistry = new ActiveSessionRegistry()
    const iterator = startSession({ activeSessionRegistry })[Symbol.asyncIterator]()
    await iterator.next()

    await activeSessionRegistry.interrupt(FAKE_CLAUDE_SESSION_ID)
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      // drain
    }

    expect(controlLog.interruptCount).toBe(1)
  })

  // Chad, 2026-08-25: a switch to Ask "HAS TO TAKE EFFECT IMMEDIATELY" — the
  // turn already running, not the next one.
  it('a live mode switch reaches the SDK — Ask becomes its default mode', async () => {
    const controlLog = installFakeQuery([
      fakeSystemInitStep(),
      fakeTextStreamStep('one'),
      fakeSuccessResultStep(),
    ])
    const activeSessionRegistry = new ActiveSessionRegistry()
    const iterator = startSession({ activeSessionRegistry })[Symbol.asyncIterator]()
    await iterator.next()

    expect(await activeSessionRegistry.setPermissionMode(FAKE_CLAUDE_SESSION_ID, 'ask')).toBe(
      true,
    )
    expect(controlLog.permissionModes).toEqual(['default'])
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      // drain
    }
  })

  it('a switch the runtime refuses is reported, never swallowed', async () => {
    const controlLog = installFakeQuery([
      fakeSystemInitStep(),
      fakeTextStreamStep('one'),
      fakeSuccessResultStep(),
    ])
    controlLog.refuseModeSwitch = true
    const activeSessionRegistry = new ActiveSessionRegistry()
    const iterator = startSession({ activeSessionRegistry })[Symbol.asyncIterator]()
    await iterator.next()

    await expect(
      activeSessionRegistry.setPermissionMode(FAKE_CLAUDE_SESSION_ID, 'bypass'),
    ).rejects.toThrow(/refused/)
    expect(controlLog.permissionModes).toEqual([])
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      // drain
    }
  })

  it('cleans up the registry when the consumer abandons iteration', async () => {
    installFakeQuery([fakeSystemInitStep(), fakeTextStreamStep('one'), fakeTextStreamStep('two')])
    const activeSessionRegistry = new ActiveSessionRegistry()
    const iterator = startSession({ activeSessionRegistry })[Symbol.asyncIterator]()

    await iterator.next() // session-started
    await iterator.return?.(undefined) // abandon — runs the generator's finally

    expect(activeSessionRegistry.listActiveSessionIds()).toEqual([])
  })

  it('interleaves synthetic approval events from canUseTool into the stream', async () => {
    installFakeQuery([
      fakeSystemInitStep(),
      { kind: 'toolUse', toolName: 'Bash', toolInput: { command: 'ls' } },
      fakeSuccessResultStep(),
    ])
    const pendingApprovalRegistry = new PendingApprovalRegistry()
    const iterator = startSession({ pendingApprovalRegistry })[Symbol.asyncIterator]()

    const events: NormalizedSessionEvent[] = []
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      const event = next.value
      events.push(event)
      if (event.kind === 'approval-requested') {
        pendingApprovalRegistry.resolve(event.approvalRequestId, { kind: 'approved' })
      }
    }

    const kinds = events.map((event) => event.kind)
    expect(kinds).toContain('approval-requested')
    expect(kinds).toContain('approval-resolved')
    expect(kinds.indexOf('approval-requested')).toBeLessThan(kinds.indexOf('approval-resolved'))
    expect(kinds.at(-1)).toBe('session-completed')
  })

  it('forwards agents + the PreToolUse safety hook + canUseTool into query()', async () => {
    installFakeQuery([fakeSystemInitStep(), fakeSuccessResultStep()])
    const agents = { researcher: { description: 'Researches.', prompt: 'You research.' } }
    await collect(
      runClaudeChatSession({
        input: { ...BASE_INPUT, agents },
        activeSessionRegistry: new ActiveSessionRegistry(),
        pendingApprovalRegistry: new PendingApprovalRegistry(),
      }),
    )

    const queryArg = mockQuery.mock.calls.at(-1)?.[0]
    // Agents reach query({ agents }) — agents go live in the session.
    expect(queryArg?.options?.agents).toEqual(agents)
    // The full safety wiring reaches the SDK: the always-on PreToolUse
    // backstop + the canUseTool approval bridge.
    expect(queryArg?.options?.hooks?.PreToolUse).toBeDefined()
    expect(typeof queryArg?.options?.canUseTool).toBe('function')
  })

  it('binds canUseTool even under the user bypass — so switching OUT of it mid-run can card', async () => {
    // Reversed 2026-08-25 (Chad: a mode switch "HAS TO TAKE EFFECT
    // IMMEDIATELY"). While the turn is genuinely in bypass the callback stays
    // dead either way — bypassPermissions auto-approves before consulting it —
    // so binding costs only the SDK's shadowed-callback warning. Leaving it
    // unbound left a bypass turn that could NEVER card, however the user
    // changed their mind partway through.
    installFakeQuery([fakeSystemInitStep(), fakeSuccessResultStep()])
    await collect(
      runClaudeChatSession({
        input: { ...BASE_INPUT, permissionMode: 'bypass' },
        activeSessionRegistry: new ActiveSessionRegistry(),
        pendingApprovalRegistry: new PendingApprovalRegistry(),
      }),
    )

    const queryArg = mockQuery.mock.calls.at(-1)?.[0]
    expect(typeof queryArg?.options?.canUseTool).toBe('function')
    // The turn still STARTS in bypass — binding the callback must not quietly
    // change the mode the SDK actually runs under.
    expect(queryArg?.options?.permissionMode).toBe('bypassPermissions')
    expect(queryArg?.options?.hooks?.PreToolUse).toBeDefined()
  })

  it('binds a PostToolUse context hook fed by the LIVE usage when onToolResultContext is provided', async () => {
    installFakeQuery([
      fakeSystemInitStep(),
      fakeAssistantMessageStep({ id: 'msg-1', text: 'working…', usage: { input_tokens: 1_000, cache_read_input_tokens: 899_000, output_tokens: 20 } }),
      fakeSuccessResultStep(),
    ])
    const seen: Array<{ usedTokens: number; model: string | null }> = []
    await collect(
      runClaudeChatSession({
        input: {
          ...BASE_INPUT,
          onToolResultContext: (state) => {
            seen.push(state)
            return 'nudge'
          },
        },
        activeSessionRegistry: new ActiveSessionRegistry(),
        pendingApprovalRegistry: new PendingApprovalRegistry(),
      }),
    )

    const queryArg = mockQuery.mock.calls.at(-1)?.[0]
    const postToolUseHook = queryArg?.options?.hooks?.PostToolUse?.[0]?.hooks?.[0]
    expect(typeof postToolUseHook).toBe('function')
    // Fired after the stream ran, the hook hands the callback the occupancy the
    // usage translation left behind (input + cache read + cache creation) and
    // returns its line as additionalContext.
    const output = await postToolUseHook!(
      {
        hook_event_name: 'PostToolUse',
        session_id: 'sdk-7',
        transcript_path: '',
        cwd: '/work/demo',
        tool_name: 'Read',
        tool_input: {},
        tool_response: 'ok',
        tool_use_id: 'tu-1',
      } as never,
      undefined,
      { signal: new AbortController().signal },
    )
    expect(seen).toEqual([{ usedTokens: 900_000, model: null }])
    expect(output).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'nudge' },
    })
  })

  it('binds a PostCompact capture hook into query() when onCompaction is provided (Q2)', async () => {
    installFakeQuery([fakeSystemInitStep(), fakeSuccessResultStep()])
    const captured: Array<{ sdkSessionId: string; summary: string }> = []
    await collect(
      runClaudeChatSession({
        input: {
          ...BASE_INPUT,
          onCompaction: (capture) => {
            captured.push(capture)
          },
        },
        activeSessionRegistry: new ActiveSessionRegistry(),
        pendingApprovalRegistry: new PendingApprovalRegistry(),
      }),
    )

    const queryArg = mockQuery.mock.calls.at(-1)?.[0]
    const postCompactHook = queryArg?.options?.hooks?.PostCompact?.[0]?.hooks?.[0]
    expect(typeof postCompactHook).toBe('function')

    // The bound hook forwards the SDK's compaction summary to onCompaction.
    await postCompactHook!(
      {
        hook_event_name: 'PostCompact',
        session_id: 'sdk-7',
        transcript_path: '',
        cwd: '/work/demo',
        compact_summary: 'the distilled summary',
      } as never,
      undefined,
      { signal: new AbortController().signal },
    )
    expect(captured).toEqual([{ sdkSessionId: 'sdk-7', summary: 'the distilled summary' }])
  })

  it('omits the PostCompact hook when onCompaction is not provided', async () => {
    installFakeQuery([fakeSystemInitStep(), fakeSuccessResultStep()])
    await collect(startSession())
    const queryArg = mockQuery.mock.calls.at(-1)?.[0]
    expect(queryArg?.options?.hooks?.PostCompact).toBeUndefined()
    // The always-on PreToolUse backstop is unaffected.
    expect(queryArg?.options?.hooks?.PreToolUse).toBeDefined()
  })
})

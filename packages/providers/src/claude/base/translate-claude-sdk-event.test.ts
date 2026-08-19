// Table-driven test for `translateClaudeSdkEvent` — one row per SDK event
// variant. The load-bearing test of the domain: drift between
// `@anthropic-ai/claude-agent-sdk` and the translation surfaces here.
// Fixtures use the real `SDKMessage` shapes from SDK 0.3.181.
// See `docs/blueprints/providers/blueprint.md §17.6` + `coding.md §8.2`.

import { describe, expect, it } from 'vitest'
import { translateClaudeSdkEvent } from './translate-claude-sdk-event.js'
import type { NormalizedSessionEvent } from '../../shared/normalized-session-event.js'

const SESSION_ID = 'sess_test'
const ASSISTANT_MESSAGE_ID = 'msg_current'

type TestCase = {
  name: string
  sdkEvent: unknown
  /** The assistant message ids that streamed deltas before this event (the
   *  runner's tracking) — omitted = nothing streamed yet. */
  streamedAssistantMessageIds?: string[]
  expected: NormalizedSessionEvent[]
}

const testCases: TestCase[] = [
  {
    name: 'stream_event content_block_delta text_delta -> TextChunkEvent',
    sdkEvent: {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      parent_tool_use_id: null,
      uuid: 'evt-1',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'text-chunk',
        sessionId: SESSION_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        textDelta: 'Hello',
        isFinalChunk: false,
      },
    ],
  },
  {
    name: 'stream_event content_block_delta thinking_delta -> ThinkingChunkEvent',
    sdkEvent: {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me think' },
      },
      parent_tool_use_id: null,
      uuid: 'evt-2',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'thinking-chunk',
        sessionId: SESSION_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        textDelta: 'Let me think',
        isFinalChunk: false,
      },
    ],
  },
  {
    name: 'stream_event content_block_start (text) -> [] (no content yet)',
    sdkEvent: {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      parent_tool_use_id: null,
      uuid: 'evt-3',
      session_id: SESSION_ID,
    },
    expected: [],
  },
  {
    name: 'stream_event content_block_stop -> []',
    sdkEvent: {
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
      parent_tool_use_id: null,
      uuid: 'evt-4',
      session_id: SESSION_ID,
    },
    expected: [],
  },
  {
    name: 'stream_event input_json_delta -> [] (tool input comes from the complete assistant message)',
    sdkEvent: {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"a":' },
      },
      parent_tool_use_id: null,
      uuid: 'evt-5',
      session_id: SESSION_ID,
    },
    expected: [],
  },
  {
    name: 'assistant message with an already-STREAMED text block + usage -> UsageReportedEvent only (text came via stream_event)',
    streamedAssistantMessageIds: ['msg_a'],
    sdkEvent: {
      type: 'assistant',
      message: {
        id: 'msg_a',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        model: 'claude-opus-4-8',
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          cache_read_input_tokens: 40,
          cache_creation_input_tokens: 3,
        },
      },
      parent_tool_use_id: null,
      uuid: 'evt-6',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'usage-reported',
        sessionId: SESSION_ID,
        messageId: 'msg_a',
        model: 'claude-opus-4-8',
        inputTokens: 12,
        outputTokens: 8,
        cacheCreationInputTokens: 3,
        cacheReadInputTokens: 40,
      },
    ],
  },
  {
    name: 'assistant message with a tool_use block + usage -> ToolUseStartedEvent then UsageReportedEvent',
    sdkEvent: {
      type: 'assistant',
      message: {
        id: 'msg_a',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }],
        usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 60 },
      },
      parent_tool_use_id: null,
      uuid: 'evt-7',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'tool-use-started',
        sessionId: SESSION_ID,
        parentMessageId: 'msg_a',
        toolUseId: 'tu_1',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        startedAt: expect.any(Date),
      },
      {
        kind: 'usage-reported',
        sessionId: SESSION_ID,
        messageId: 'msg_a',
        inputTokens: 5,
        outputTokens: 2,
        cacheReadInputTokens: 60,
      },
    ],
  },
  {
    name: 'assistant message mixing STREAMED text + tool_use + usage -> ToolUseStartedEvent then UsageReportedEvent',
    streamedAssistantMessageIds: ['msg_b'],
    sdkEvent: {
      type: 'assistant',
      message: {
        id: 'msg_b',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running it' },
          { type: 'tool_use', id: 'tu_2', name: 'Read', input: { file: 'a.txt' } },
        ],
        usage: { input_tokens: 7, output_tokens: 4 },
      },
      parent_tool_use_id: null,
      uuid: 'evt-8',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'tool-use-started',
        sessionId: SESSION_ID,
        parentMessageId: 'msg_b',
        toolUseId: 'tu_2',
        toolName: 'Read',
        toolInput: { file: 'a.txt' },
        startedAt: expect.any(Date),
      },
      {
        kind: 'usage-reported',
        sessionId: SESSION_ID,
        messageId: 'msg_b',
        inputTokens: 7,
        outputTokens: 4,
      },
    ],
  },
  {
    name: 'assistant message with tool_use but no usage -> only ToolUseStartedEvent (usage is optional)',
    sdkEvent: {
      type: 'assistant',
      message: {
        id: 'msg_c',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_9', name: 'Glob', input: {} }],
      },
      parent_tool_use_id: null,
      uuid: 'evt-9',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'tool-use-started',
        sessionId: SESSION_ID,
        parentMessageId: 'msg_c',
        toolUseId: 'tu_9',
        toolName: 'Glob',
        toolInput: {},
        startedAt: expect.any(Date),
      },
    ],
  },
  {
    name: 'user message with a tool_result block -> ToolUseCompletedEvent',
    sdkEvent: {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'file.txt', is_error: false },
        ],
      },
      parent_tool_use_id: null,
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'tool-use-completed',
        sessionId: SESSION_ID,
        parentMessageId: ASSISTANT_MESSAGE_ID,
        toolUseId: 'tu_1',
        output: 'file.txt',
        isError: false,
        completedAt: expect.any(Date),
      },
    ],
  },
  {
    name: 'user message with an error tool_result -> ToolUseCompletedEvent isError true',
    sdkEvent: {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_3', content: 'command failed', is_error: true },
        ],
      },
      parent_tool_use_id: null,
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'tool-use-completed',
        sessionId: SESSION_ID,
        parentMessageId: ASSISTANT_MESSAGE_ID,
        toolUseId: 'tu_3',
        output: 'command failed',
        isError: true,
        completedAt: expect.any(Date),
      },
    ],
  },
  {
    name: 'user message with plain string content -> [] (user text is not an assistant event)',
    sdkEvent: {
      type: 'user',
      message: { role: 'user', content: 'hello there' },
      parent_tool_use_id: null,
      session_id: SESSION_ID,
    },
    expected: [],
  },
  {
    name: 'result message (success) -> [] (usage now rides on assistant messages; runner owns lifecycle)',
    sdkEvent: {
      type: 'result',
      subtype: 'success',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
      session_id: SESSION_ID,
      uuid: 'evt-r',
    },
    expected: [],
  },
  {
    name: 'result message (error subtype) -> [] (runner owns the errored lifecycle)',
    sdkEvent: {
      type: 'result',
      subtype: 'error_max_turns',
      usage: { input_tokens: 20, output_tokens: 0 },
      session_id: SESSION_ID,
      uuid: 'evt-re',
    },
    expected: [],
  },
  // ── The SDK's own refusal (auto-mode classifier / deny rule / mode) ──────
  {
    name: 'system permission_denied -> ToolUseBlockedEvent (decision reason ANSI-stripped)',
    sdkEvent: {
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Bash',
      tool_use_id: 'tu_blocked',
      decision_reason_type: 'classifier',
      decision_reason:
        '\u001b[33mWriting a crontab on a remote host is irreversible without clear user intent\u001b[0m ',
      message:
        "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
      uuid: 'evt-pd',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'tool-use-blocked',
        sessionId: SESSION_ID,
        toolUseId: 'tu_blocked',
        toolName: 'Bash',
        reasonType: 'classifier',
        reason: 'Writing a crontab on a remote host is irreversible without clear user intent',
        message:
          "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
        blockedAt: expect.any(Date),
      },
    ],
  },
  {
    name: 'system permission_denied without a reason -> ToolUseBlockedEvent with null reasonType/reason',
    sdkEvent: {
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'mcp__ssh__run_command',
      tool_use_id: 'tu_blocked_bare',
      decision_reason: '   ',
      message: 'Permission denied.',
      uuid: 'evt-pd-bare',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'tool-use-blocked',
        sessionId: SESSION_ID,
        toolUseId: 'tu_blocked_bare',
        toolName: 'mcp__ssh__run_command',
        reasonType: null,
        reason: null,
        message: 'Permission denied.',
        blockedAt: expect.any(Date),
      },
    ],
  },
  {
    name: 'system permission_denied missing its tool_use_id -> [] (no throw)',
    sdkEvent: {
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Bash',
      message: 'Permission denied.',
      uuid: 'evt-pd-broken',
      session_id: SESSION_ID,
    },
    expected: [],
  },
  {
    name: 'system init (any other subtype) -> [] (the runner owns the lifecycle)',
    sdkEvent: {
      type: 'system',
      subtype: 'init',
      cwd: '/tmp',
      session_id: SESSION_ID,
      tools: [],
      model: 'claude-opus-5',
      uuid: 'evt-init',
    },
    expected: [],
  },
  {
    name: 'unknown SDK event type -> [] (no throw)',
    sdkEvent: { type: 'tool_progress', tool_use_id: 'tu_1', session_id: SESSION_ID },
    expected: [],
  },
  {
    name: 'non-object input -> [] (no throw)',
    sdkEvent: 'not an object',
    expected: [],
  },
  // ── Subagent traffic (top-level parent_tool_use_id set) ─────────────────
  {
    name: 'SUBAGENT stream text_delta -> TextChunkEvent marked with parentToolUseId',
    sdkEvent: {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'agent says' },
      },
      parent_tool_use_id: 'tu_agent_1',
      uuid: 'evt-sub-1',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'text-chunk',
        sessionId: SESSION_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        textDelta: 'agent says',
        isFinalChunk: false,
        parentToolUseId: 'tu_agent_1',
      },
    ],
  },
  {
    name: 'SUBAGENT assistant tool_use -> marked tool-use-started, usage SKIPPED (own context window)',
    sdkEvent: {
      type: 'assistant',
      message: {
        id: 'msg_sub_1',
        content: [
          { type: 'tool_use', id: 'tu_sub_read', name: 'Read', input: { file_path: 'a.md' } },
        ],
        usage: { input_tokens: 999, output_tokens: 9 },
      },
      parent_tool_use_id: 'tu_agent_1',
      uuid: 'evt-sub-2',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'tool-use-started',
        sessionId: SESSION_ID,
        parentMessageId: 'msg_sub_1',
        toolUseId: 'tu_sub_read',
        toolName: 'Read',
        toolInput: { file_path: 'a.md' },
        startedAt: expect.any(Date),
        parentToolUseId: 'tu_agent_1',
      },
      // NO usage-reported — a subagent's usage would overwrite the main
      // session's occupancy under the consumer's keep-the-last rule.
    ],
  },
  {
    name: 'SUBAGENT user tool_result -> marked tool-use-completed',
    sdkEvent: {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tu_sub_read', content: 'file body', is_error: false },
        ],
      },
      parent_tool_use_id: 'tu_agent_1',
      uuid: 'evt-sub-3',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'tool-use-completed',
        sessionId: SESSION_ID,
        parentMessageId: ASSISTANT_MESSAGE_ID,
        toolUseId: 'tu_sub_read',
        output: 'file body',
        isError: false,
        completedAt: expect.any(Date),
        parentToolUseId: 'tu_agent_1',
      },
    ],
  },
  // The CLI's NON-STREAMING FALLBACK ("Error streaming, falling back to
  // non-streaming mode"): the complete assistant message arrives with no
  // stream_event deltas before it — its text/thinking exist ONLY here. The
  // 2026-08-18 lost reply: a 100s turn ended clean with nothing persisted.
  {
    name: 'assistant message whose id never streamed -> text/thinking replayed as FINAL chunks (block order), then tool_use, then usage',
    sdkEvent: {
      type: 'assistant',
      message: {
        id: 'msg_unstreamed',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me look.', signature: 'sig' },
          { type: 'text', text: "Here's the overview." },
          { type: 'tool_use', id: 'tu_f', name: 'Read', input: { file: 'README.md' } },
        ],
        model: 'claude-opus-5',
        usage: { input_tokens: 9, output_tokens: 3 },
      },
      parent_tool_use_id: null,
      uuid: 'evt-fallback',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'thinking-chunk',
        sessionId: SESSION_ID,
        messageId: 'msg_unstreamed',
        textDelta: 'Let me look.',
        isFinalChunk: true,
      },
      {
        kind: 'text-chunk',
        sessionId: SESSION_ID,
        messageId: 'msg_unstreamed',
        textDelta: "Here's the overview.",
        isFinalChunk: true,
      },
      {
        kind: 'tool-use-started',
        sessionId: SESSION_ID,
        parentMessageId: 'msg_unstreamed',
        toolUseId: 'tu_f',
        toolName: 'Read',
        toolInput: { file: 'README.md' },
        startedAt: expect.any(Date),
      },
      {
        kind: 'usage-reported',
        sessionId: SESSION_ID,
        messageId: 'msg_unstreamed',
        model: 'claude-opus-5',
        inputTokens: 9,
        outputTokens: 3,
      },
    ],
  },
  {
    name: 'assistant message whose id never streamed but has only EMPTY text -> nothing replayed',
    sdkEvent: {
      type: 'assistant',
      message: {
        id: 'msg_empty',
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
      },
      parent_tool_use_id: null,
      uuid: 'evt-fallback-empty',
      session_id: SESSION_ID,
    },
    expected: [],
  },
  {
    name: "SYNTHETIC assistant message (model '<synthetic>', the CLI's error surrogate) -> text replays, usage is DROPPED (zeroed usage would erase the session's real occupancy and poison its model column)",
    sdkEvent: {
      type: 'assistant',
      message: {
        id: 'msg_synthetic',
        role: 'assistant',
        content: [{ type: 'text', text: 'Prompt is too long' }],
        model: '<synthetic>',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
      parent_tool_use_id: null,
      uuid: 'evt-synthetic',
      session_id: SESSION_ID,
    },
    expected: [
      {
        kind: 'text-chunk',
        sessionId: SESSION_ID,
        messageId: 'msg_synthetic',
        textDelta: 'Prompt is too long',
        isFinalChunk: true,
      },
    ],
  },
  {
    name: 'SUBAGENT assistant text never "streamed" under its own id -> NOT replayed (its deltas ride the main id; replay would double the Agent card)',
    sdkEvent: {
      type: 'assistant',
      message: {
        id: 'msg_sub_text',
        role: 'assistant',
        content: [{ type: 'text', text: 'subagent says hi' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      parent_tool_use_id: 'tu_agent_1',
      uuid: 'evt-sub-text',
      session_id: SESSION_ID,
    },
    expected: [],
  },
]

describe('translateClaudeSdkEvent', () => {
  for (const { name, sdkEvent, streamedAssistantMessageIds, expected } of testCases) {
    it(name, () => {
      const result = translateClaudeSdkEvent({
        sdkEvent,
        sessionId: SESSION_ID,
        currentAssistantMessageId: ASSISTANT_MESSAGE_ID,
        streamedAssistantMessageIds: new Set(streamedAssistantMessageIds ?? []),
      })
      expect(result).toEqual(expected)
    })
  }
})

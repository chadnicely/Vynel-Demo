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
    name: 'assistant message with a text block + usage -> UsageReportedEvent (text streams via stream_event)',
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
    name: 'assistant message mixing text + tool_use + usage -> ToolUseStartedEvent then UsageReportedEvent',
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
]

describe('translateClaudeSdkEvent', () => {
  for (const { name, sdkEvent, expected } of testCases) {
    it(name, () => {
      const result = translateClaudeSdkEvent({
        sdkEvent,
        sessionId: SESSION_ID,
        currentAssistantMessageId: ASSISTANT_MESSAGE_ID,
      })
      expect(result).toEqual(expected)
    })
  }
})

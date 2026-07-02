// Table-driven test for `translatePersistedClaudeMessage` — the replay
// translator. Mirrors the live translator's test scope; fixtures use the real
// Claude Code session-JSONL record shapes (inspected from on-disk sessions).
// See `docs/blueprints/providers/blueprint.md §11.5` + `coding.md §1.2`.

import { describe, expect, it } from 'vitest'
import { translatePersistedClaudeMessage } from './translate-persisted-claude-message.js'
import type { ClaudeSessionJsonlRecord } from './claude-session-storage.js'
import type { NormalizedSessionEvent } from '../../shared/normalized-session-event.js'

const SESSION_ID = 'sess_test'
const PRIOR_ASSISTANT_MESSAGE_ID = 'msg_prior'
const TIMESTAMP = '2026-05-22T08:00:00.000Z'

type TestCase = {
  name: string
  jsonlRecord: ClaudeSessionJsonlRecord
  expected: NormalizedSessionEvent[]
}

const testCases: TestCase[] = [
  {
    name: 'assistant text block -> text-chunk (one complete chunk)',
    jsonlRecord: {
      type: 'assistant',
      timestamp: TIMESTAMP,
      message: { id: 'msg_a', role: 'assistant', content: [{ type: 'text', text: 'Hello.' }] },
    },
    expected: [
      {
        kind: 'text-chunk',
        sessionId: SESSION_ID,
        messageId: 'msg_a',
        textDelta: 'Hello.',
        isFinalChunk: true,
      },
    ],
  },
  {
    name: 'assistant thinking block -> thinking-chunk',
    jsonlRecord: {
      type: 'assistant',
      timestamp: TIMESTAMP,
      message: {
        id: 'msg_a',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'Hmm.' }],
      },
    },
    expected: [
      {
        kind: 'thinking-chunk',
        sessionId: SESSION_ID,
        messageId: 'msg_a',
        textDelta: 'Hmm.',
        isFinalChunk: true,
      },
    ],
  },
  {
    name: 'assistant tool_use block -> tool-use-started (full input, original timestamp)',
    jsonlRecord: {
      type: 'assistant',
      timestamp: TIMESTAMP,
      message: {
        id: 'msg_a',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }],
      },
    },
    expected: [
      {
        kind: 'tool-use-started',
        sessionId: SESSION_ID,
        parentMessageId: 'msg_a',
        toolUseId: 'tu_1',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        startedAt: new Date(TIMESTAMP),
      },
    ],
  },
  {
    name: 'assistant message mixing text + tool_use -> both events in order',
    jsonlRecord: {
      type: 'assistant',
      timestamp: TIMESTAMP,
      message: {
        id: 'msg_b',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running it.' },
          { type: 'tool_use', id: 'tu_2', name: 'Read', input: { file: 'a.txt' } },
        ],
      },
    },
    expected: [
      {
        kind: 'text-chunk',
        sessionId: SESSION_ID,
        messageId: 'msg_b',
        textDelta: 'Running it.',
        isFinalChunk: true,
      },
      {
        kind: 'tool-use-started',
        sessionId: SESSION_ID,
        parentMessageId: 'msg_b',
        toolUseId: 'tu_2',
        toolName: 'Read',
        toolInput: { file: 'a.txt' },
        startedAt: new Date(TIMESTAMP),
      },
    ],
  },
  {
    name: 'assistant message with usage -> usage NOT translated (content events only)',
    jsonlRecord: {
      type: 'assistant',
      timestamp: TIMESTAMP,
      message: {
        id: 'msg_a',
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    },
    expected: [
      {
        kind: 'text-chunk',
        sessionId: SESSION_ID,
        messageId: 'msg_a',
        textDelta: 'Done.',
        isFinalChunk: true,
      },
    ],
  },
  {
    name: 'user tool_result block -> tool-use-completed (parent = threaded assistant id)',
    jsonlRecord: {
      type: 'user',
      timestamp: TIMESTAMP,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file.txt' }],
      },
    },
    expected: [
      {
        kind: 'tool-use-completed',
        sessionId: SESSION_ID,
        parentMessageId: PRIOR_ASSISTANT_MESSAGE_ID,
        toolUseId: 'tu_1',
        output: 'file.txt',
        isError: false,
        completedAt: new Date(TIMESTAMP),
      },
    ],
  },
  {
    name: 'user error tool_result -> tool-use-completed isError true',
    jsonlRecord: {
      type: 'user',
      timestamp: TIMESTAMP,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_3', content: 'boom', is_error: true }],
      },
    },
    expected: [
      {
        kind: 'tool-use-completed',
        sessionId: SESSION_ID,
        parentMessageId: PRIOR_ASSISTANT_MESSAGE_ID,
        toolUseId: 'tu_3',
        output: 'boom',
        isError: true,
        completedAt: new Date(TIMESTAMP),
      },
    ],
  },
  {
    name: 'user message with plain string content -> [] (the user prompt, not an assistant event)',
    jsonlRecord: {
      type: 'user',
      timestamp: TIMESTAMP,
      message: { role: 'user', content: 'what files are here?' },
    },
    expected: [],
  },
  {
    name: 'isSidechain: true record -> [] (Task-subagent traffic, not main-thread)',
    jsonlRecord: {
      type: 'assistant',
      isSidechain: true,
      timestamp: TIMESTAMP,
      message: { id: 'msg_sub', role: 'assistant', content: [{ type: 'text', text: 'subagent' }] },
    },
    expected: [],
  },
  {
    name: 'summary record -> []',
    jsonlRecord: { type: 'summary', summary: 'A chat about X', leafUuid: 'u1' },
    expected: [],
  },
  {
    name: 'file-history-snapshot record -> []',
    jsonlRecord: { type: 'file-history-snapshot', messageId: 'm1', snapshot: {} },
    expected: [],
  },
  {
    name: 'system record -> []',
    jsonlRecord: { type: 'system', timestamp: TIMESTAMP, content: 'session resumed' },
    expected: [],
  },
  {
    name: 'attachment record -> []',
    jsonlRecord: { type: 'attachment', timestamp: TIMESTAMP },
    expected: [],
  },
  {
    name: 'assistant record with no message -> []',
    jsonlRecord: { type: 'assistant', timestamp: TIMESTAMP },
    expected: [],
  },
  {
    name: 'empty record -> []',
    jsonlRecord: {},
    expected: [],
  },
]

describe('translatePersistedClaudeMessage', () => {
  for (const { name, jsonlRecord, expected } of testCases) {
    it(name, () => {
      const result = translatePersistedClaudeMessage({
        jsonlRecord,
        sessionId: SESSION_ID,
        currentAssistantMessageId: PRIOR_ASSISTANT_MESSAGE_ID,
      })
      expect(result).toEqual(expected)
    })
  }
})

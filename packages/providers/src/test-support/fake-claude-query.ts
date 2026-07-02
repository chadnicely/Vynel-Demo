// `fake-claude-query` — test support. A stand-in for the Claude Agent SDK's
// `query()`: returns a fake `Query` (an async generator over a scripted
// message sequence) that honours `options.abortController` and drives
// `options.canUseTool` like the real runtime. Shared by the provider tests
// that must exercise session flows without a real Claude Code process.
//
// In `src/test-support/` per the `packages/db/src/test-support/` precedent —
// a home for cross-file test infrastructure.

import type { query } from '../claude/base/claude-agent-sdk.js'

export type FakeClaudeQueryStep =
  | { kind: 'emit'; message: Record<string, unknown> }
  | { kind: 'toolUse'; toolName: string; toolInput: Record<string, unknown> }

type FakeClaudeQueryOptions = {
  abortController?: AbortController
  canUseTool?: (
    toolName: string,
    toolInput: Record<string, unknown>,
    callbackOptions: { signal: AbortSignal; toolUseID: string },
  ) => Promise<unknown>
}

/** The session id every fake-message builder stamps onto its message. */
export const FAKE_CLAUDE_SESSION_ID = 'sess-fake'

/**
 * Builds a fake `query()` implementation that replays `script` — assignable
 * to `vi.mocked(query).mockImplementation(...)`.
 */
export function createFakeClaudeQuery(script: FakeClaudeQueryStep[]): typeof query {
  return (params) => {
    const options = (params.options ?? {}) as FakeClaudeQueryOptions
    async function* generate(): AsyncGenerator<unknown, void> {
      for (const step of script) {
        await Promise.resolve() // let the event loop turn between steps
        if (options.abortController?.signal.aborted === true) {
          const abortError = new Error('The session was interrupted.')
          abortError.name = 'AbortError'
          throw abortError
        }
        if (step.kind === 'emit') {
          yield step.message
        } else if (options.canUseTool !== undefined) {
          await options.canUseTool(step.toolName, step.toolInput, {
            signal: options.abortController?.signal ?? new AbortController().signal,
            toolUseID: 'tu_fake',
          })
        }
      }
    }
    return generate() as unknown as ReturnType<typeof query>
  }
}

/** A `system`/`init` message — the SDK's first message; carries the session id. */
export function fakeSystemInitStep(): FakeClaudeQueryStep {
  return {
    kind: 'emit',
    message: { type: 'system', subtype: 'init', session_id: FAKE_CLAUDE_SESSION_ID },
  }
}

/** A streamed assistant text delta. */
export function fakeTextStreamStep(text: string): FakeClaudeQueryStep {
  return {
    kind: 'emit',
    message: {
      type: 'stream_event',
      session_id: FAKE_CLAUDE_SESSION_ID,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    },
  }
}

/** A complete `assistant` message — carries the per-request `usage` (the
 *  occupancy source) + optional text content. Emitted after the text stream and
 *  before the result, mirroring the real SDK message order. */
export function fakeAssistantMessageStep(
  options: { id?: string; text?: string; usage?: Record<string, number> } = {},
): FakeClaudeQueryStep {
  const content: Array<Record<string, unknown>> = []
  if (options.text !== undefined) content.push({ type: 'text', text: options.text })
  return {
    kind: 'emit',
    message: {
      type: 'assistant',
      session_id: FAKE_CLAUDE_SESSION_ID,
      message: {
        id: options.id ?? 'msg_fake',
        role: 'assistant',
        content,
        usage: options.usage ?? { input_tokens: 100, output_tokens: 50 },
      },
    },
  }
}

/** A successful `result` message — ends the session. Its usage is no longer the
 *  occupancy source (that's each assistant message); the runner reads it only
 *  for the session-completed/-errored lifecycle. */
export function fakeSuccessResultStep(): FakeClaudeQueryStep {
  return {
    kind: 'emit',
    message: { type: 'result', subtype: 'success', session_id: FAKE_CLAUDE_SESSION_ID, usage: {} },
  }
}

// A scripted stand-in for the SDK's `query()` — replays messages and tool
// uses, honours the abort signal, and records the out-of-band CONTROL calls
// (a stop's interrupt, a live mode switch) so a test can watch them.

import type { query } from '../claude/base/claude-agent-sdk.js'

export type FakeClaudeQueryStep =
  | { kind: 'emit'; message: Record<string, unknown> }
  | { kind: 'toolUse'; toolName: string; toolInput: Record<string, unknown> }

type FakeClaudeQueryOptions = {
  abortController?: AbortController
  canUseTool?: (
    toolName: string,
    toolInput: Record<string, unknown>,
    callbackOptions: { signal: AbortSignal; toolUseID: string; requestId: string },
  ) => Promise<unknown>
}

/** The session id every fake-message builder stamps onto its message. */
export const FAKE_CLAUDE_SESSION_ID = 'sess-fake'

/** What the runtime was ASKED to do out-of-band — the control-protocol calls
 *  a stop and a live mode switch make. Shared so a test can watch them. */
export type FakeClaudeQueryControlLog = {
  interruptCount: number
  permissionModes: string[]
  /** Make the next mode switch fail the way a runtime that refuses it would. */
  refuseModeSwitch?: boolean
}

export function createFakeClaudeQueryControlLog(): FakeClaudeQueryControlLog {
  return { interruptCount: 0, permissionModes: [] }
}

/**
 * Builds a fake `query()` implementation that replays `script` — assignable
 * to `vi.mocked(query).mockImplementation(...)`. Control calls land in
 * `controlLog` (a fresh one when the test does not care).
 */
export function createFakeClaudeQuery(
  script: FakeClaudeQueryStep[],
  controlLog: FakeClaudeQueryControlLog = createFakeClaudeQueryControlLog(),
): typeof query {
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
            requestId: 'req_fake',
          })
        }
      }
    }
    // The real Query is the async iterator PLUS the control methods; the
    // runner reaches both through the one object.
    const controls = {
      interrupt: async () => {
        controlLog.interruptCount += 1
      },
      setPermissionMode: async (mode: string) => {
        if (controlLog.refuseModeSwitch === true) {
          throw new Error(`the runtime refused the switch to ${mode}`)
        }
        controlLog.permissionModes.push(mode)
      },
    }
    return Object.assign(generate(), controls) as unknown as ReturnType<typeof query>
  }
}

/** A `system`/`init` message — the SDK's first message; carries the session id. */
export function fakeSystemInitStep(): FakeClaudeQueryStep {
  return {
    kind: 'emit',
    message: { type: 'system', subtype: 'init', session_id: FAKE_CLAUDE_SESSION_ID },
  }
}

/** The `message_start` stream event that opens a streamed assistant message —
 *  the runner reads the message id off it, so the deltas that follow (and the
 *  complete message's "already streamed" check) key to the same id. */
export function fakeMessageStartStep(id = 'msg_fake'): FakeClaudeQueryStep {
  return {
    kind: 'emit',
    message: {
      type: 'stream_event',
      session_id: FAKE_CLAUDE_SESSION_ID,
      event: { type: 'message_start', message: { id, role: 'assistant', content: [] } },
    },
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

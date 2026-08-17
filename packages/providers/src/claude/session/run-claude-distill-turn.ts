// `runClaudeDistillTurn` — the ONE home for ephemeral text-distill dispatches
// (the swap-carry session summary, the delegation report reply, and every
// distill that comes after). A distill reads text and writes text; its walls
// are the point and are NOT caller-configurable:
//
//   - `maxTurns: 1` — one dispatch, no loop.
//   - `tools: []` — TRULY toolless. This is the SDK's kill-switch; an empty
//     ALLOW-list (`allowedToolNames: []`) means "no restriction" in
//     buildClaudeSdkOptions, which is how a "no tools" comment once shipped
//     with the full toolset live under bypass — an indirect-injection egress
//     channel over model-produced text. Reviewer catch, 2026-07-19.
//   - `persistSession: false` — never writes a session JSONL (a resumed
//     distill must not append to Vynel's source-of-truth transcript).
//   - A wall-clock deadline (`DISTILL_TIMEOUT_MS`) — a distill must END. The
//     swap-carry summary resumes a session that may sit at 85% of a 1M window,
//     so a slow answer is legitimate; a CLI that never terminates the stream is
//     not, and every caller runs under a lock (the global root's is per USER —
//     a stall there wedged web, voice and Telegram alike). Past the deadline
//     the query is aborted and the distill reports null.
//   - Best-effort: a throw is logged and returns null; callers fall open.
//
// Bypass permission mode is safe HERE because no tools exist to permit; it
// keeps the dispatch free of any interactive permission machinery.
//
// `runClaudeContextReport` is deliberately NOT a caller: `/context` is a
// local command (no model call, so no injection surface) whose report must
// reflect the session's FAITHFUL shape — its tool/MCP configuration is the
// very data being measured, so `tools: []` would falsify it.

import { query } from '../base/claude-agent-sdk.js'
import type { ProviderLogger } from '../../shared/provider-logger.js'
import { buildClaudeSdkOptions } from '../base/build-claude-sdk-options.js'

// Twice the swap-priming bound (120s): the summary distill's worst legitimate
// case is a cold (uncached) resume of a near-full 1M-window session — a
// minute-or-two answer — and the deadline is for the runtime that never ends
// the stream, not for a slow one.
export const DISTILL_TIMEOUT_MS = 240_000

export type ClaudeDistillTurnInput = {
  /** The complete distill instruction — the one turn's entire prompt. */
  prompt: string

  /** The dispatch cwd. */
  workspacePath: string

  /** Resume a session read-only (the summary covers its conversation);
   *  omit for a fresh dispatch over prompt-carried text. */
  resumeSessionId?: string

  /** The model — callers pass a cheap one (a distill is a short, mechanical
   *  read-and-write). Omit for the CLI default. */
  model?: string

  /** The warn line logged when the dispatch throws — the caller's context. */
  failureLogMessage: string

  logger?: ProviderLogger | undefined
}

export async function runClaudeDistillTurn(
  input: ClaudeDistillTurnInput,
): Promise<string | null> {
  const options = buildClaudeSdkOptions({
    // Pure `bypass`, deliberately: this internal turn is TOOLLESS (tools: []
    // below), so a behavior-gate floor has nothing to card — and the wall the
    // test pins is "can never prompt" (SDK bypassPermissions). The unattended
    // `bypass-with-behavior-gate` now maps to SDK `default` for the card
    // path, which would let a prompt block a turn no human is watching.
    permissionMode: 'bypass',
    workspacePath: input.workspacePath,
    allowedToolNames: [],
    deniedToolNames: [],
    ...(input.resumeSessionId !== undefined
      ? { resumeSessionId: input.resumeSessionId }
      : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
  })
  options.maxTurns = 1
  options.tools = []
  options.persistSession = false
  const abortController = new AbortController()
  options.abortController = abortController
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, DISTILL_TIMEOUT_MS)
  deadline.unref?.()

  try {
    for await (const message of query({ prompt: input.prompt, options })) {
      if (message.type === 'result' && message.subtype === 'success') {
        return typeof message.result === 'string' && message.result.length > 0
          ? message.result
          : null
      }
    }
    return null
  } catch (error) {
    input.logger?.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        ...(timedOut ? { timedOutAfterMs: DISTILL_TIMEOUT_MS } : {}),
      },
      timedOut
        ? `${input.failureLogMessage} — the distill did not finish within ${DISTILL_TIMEOUT_MS}ms and was aborted`
        : input.failureLogMessage,
    )
    return null
  } finally {
    clearTimeout(deadline)
    // Idempotent — a no-op if the query already completed.
    abortController.abort()
  }
}

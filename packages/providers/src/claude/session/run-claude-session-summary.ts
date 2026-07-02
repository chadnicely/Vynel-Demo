// `runClaudeSessionSummary` — distills a session into a hand-off summary (the
// CARRY for the seed-fresh swap). Resumes the session so the summary covers the
// full conversation, then dispatches one summarization turn on a cheap model
// and returns the result text. Mirrors `runClaudeContextReport`: reuses
// `buildClaudeSdkOptions` (faithful session shape), `maxTurns: 1`, and
// `persistSession: false` so the summary turn never writes the session's JSONL
// (it's an ephemeral read, not part of the conversation). Best-effort: a
// failure is logged and returns null — never throws. The swap aborts cleanly
// when the carry is null (continuity can't be preserved without it).

import { query } from '../base/claude-agent-sdk.js'
import type { SummarizeSessionInput } from '../../shared/summarize-session-input.js'
import { buildClaudeSdkOptions } from '../base/build-claude-sdk-options.js'

// The carry prompt. Folds "open todos" into DONE / IN PROGRESS / NEXT so a
// fresh session can continue the work — not just recall facts (the
// carry-fidelity bar, session-continuity.md §4).
const SESSION_SUMMARY_PROMPT = `Produce a concise hand-off summary so this work can continue in a FRESH session that will NOT have access to this transcript. Use these exact labelled lines, each terse and literal:

GOAL: the task or objective being worked on.
DONE: what has already been completed.
IN PROGRESS: what is mid-step right now.
NEXT: the immediate next action(s) to take.
FACTS: the key names, numbers, decisions, file paths, and constraints that must not be lost.

Prefer the user's own values verbatim over paraphrase. No preamble, no pleasantries — output only the labelled lines.`

export async function runClaudeSessionSummary(
  input: SummarizeSessionInput,
): Promise<string | null> {
  const options = buildClaudeSdkOptions({
    workspacePath: input.workspacePath,
    resumeSessionId: input.resumeSessionId,
    permissionMode: input.permissionMode,
    allowedToolNames: input.allowedToolNames,
    deniedToolNames: input.deniedToolNames,
    ...(input.model !== undefined ? { model: input.model } : {}),
  })
  options.maxTurns = 1
  // Ephemeral — the summary turn must NOT append to the session's JSONL (the
  // same read-only discipline as the /context probe).
  options.persistSession = false
  const abortController = new AbortController()
  options.abortController = abortController

  try {
    for await (const message of query({ prompt: SESSION_SUMMARY_PROMPT, options })) {
      if (message.type === 'result' && message.subtype === 'success') {
        return typeof message.result === 'string' && message.result.length > 0
          ? message.result
          : null
      }
    }
    return null
  } catch (error) {
    input.logger?.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'failed to summarize the session for the swap carry',
    )
    return null
  } finally {
    abortController.abort()
  }
}

// `runClaudeSessionSummary` — distills a session into a hand-off summary (the
// CARRY for the seed-fresh swap). Resumes the session so the summary covers
// the full conversation. The dispatch discipline (one turn, truly toolless,
// no JSONL write, null-on-failure) lives in `runClaudeDistillTurn` — this
// file owns only the carry prompt.

import type { SummarizeSessionInput } from '../../shared/summarize-session-input.js'
import { runClaudeDistillTurn } from './run-claude-distill-turn.js'

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
  return runClaudeDistillTurn({
    prompt: SESSION_SUMMARY_PROMPT,
    workspacePath: input.workspacePath,
    resumeSessionId: input.resumeSessionId,
    ...(input.model !== undefined ? { model: input.model } : {}),
    failureLogMessage: 'failed to summarize the session for the swap carry',
    logger: input.logger,
  })
}

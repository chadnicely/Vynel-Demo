// `runClaudeReportSummary` — distills a workspace manager's full delegation
// report into the short reply the user reads (the global chat's summary row /
// a channel-formatted message). Dispatches FRESH — the report text rides the
// prompt. The dispatch discipline (one turn, truly toolless, no JSONL write,
// null-on-failure) lives in `runClaudeDistillTurn` — this file owns the
// reply prompt and the cheap-model default. Callers fall open to the full
// report on null, so the user never loses the answer.

import type {
  SummarizeReportInput,
  ReportDeliveryTarget,
} from '../../shared/summarize-report-input.js'
import { runClaudeDistillTurn } from './run-claude-distill-turn.js'

// A short, mechanical read-and-distill — always the cheap model, never the
// user's turn model (the swap-carry precedent).
const REPORT_REPLY_MODEL = 'claude-haiku-4-5'

// Where the reply lands shapes its form; the substance rules are shared.
const TARGET_FORMAT_RULES: Record<ReportDeliveryTarget, string> = {
  chat: 'It will be shown in a chat app. 2-5 sentences of plain prose; use a short list only if the results genuinely enumerate.',
  telegram:
    'It will be sent as a Telegram message. Plain text only — no markdown headings, tables, or code blocks. Keep it under 900 characters.',
  discord:
    'It will be sent as a Discord message. Simple markdown only (bold, short lists). Keep it under 1500 characters.',
}

function buildPrompt(input: SummarizeReportInput): string {
  return `You manage the "${input.workspaceName}" workspace and just finished a task for your user. Below are the task and your full working report. Write the short reply you send back to the user.

Rules:
- Lead with the outcome, then the key results — names, numbers, and decisions verbatim from the report.
- Plain language, first person, no preamble.
- Do not mention this summarization step or refer the user to "the full report" — just answer.
- ${TARGET_FORMAT_RULES[input.deliveryTarget]}
- Output ONLY the reply text.

TASK:
${input.taskText}

FULL REPORT:
${input.reportText}`
}

export async function runClaudeReportSummary(
  input: SummarizeReportInput,
): Promise<string | null> {
  return runClaudeDistillTurn({
    prompt: buildPrompt(input),
    workspacePath: input.workspacePath,
    model: input.model ?? REPORT_REPLY_MODEL,
    failureLogMessage: 'failed to distill the delegation report into a user reply',
    logger: input.logger,
  })
}

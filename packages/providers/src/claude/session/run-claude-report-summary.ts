// `runClaudeReportSummary` — distills a workspace manager's full delegation
// report into the short reply the user reads (the global chat's summary row /
// a channel-formatted message). Mirrors `runClaudeSessionSummary`'s one-shot
// ephemeral discipline: `maxTurns: 1`, `persistSession: false`, a cheap model,
// no tools — but dispatches FRESH (no resume; the report text rides the
// prompt). Best-effort: a failure is logged and returns null — the caller
// falls open to the full report, so the user never loses the answer.

import { query } from '../base/claude-agent-sdk.js'
import type {
  SummarizeReportInput,
  ReportDeliveryTarget,
} from '../../shared/summarize-report-input.js'
import { buildClaudeSdkOptions } from '../base/build-claude-sdk-options.js'

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
  const options = buildClaudeSdkOptions({
    workspacePath: input.workspacePath,
    permissionMode: 'bypass-with-behavior-gate',
    allowedToolNames: [],
    deniedToolNames: [],
    model: input.model ?? REPORT_REPLY_MODEL,
  })
  options.maxTurns = 1
  // TRULY no tools (`allowedTools: []` would mean "no restriction"): the
  // report text is delegate-produced — under bypass, a tool-capable distill
  // would be an indirect-injection egress channel. Text in, text out.
  options.tools = []
  // Ephemeral — a distill dispatch must NOT leave a session JSONL behind (the
  // same read-only discipline as the /context probe and the swap carry).
  options.persistSession = false
  const abortController = new AbortController()
  options.abortController = abortController

  try {
    for await (const message of query({ prompt: buildPrompt(input), options })) {
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
      'failed to distill the delegation report into a user reply',
    )
    return null
  } finally {
    abortController.abort()
  }
}

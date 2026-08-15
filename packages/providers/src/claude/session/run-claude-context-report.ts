// `runClaudeContextReport` — dispatches the Agent SDK's `/context` slash command
// for a session and returns the breakdown markdown from the `result` message
// (the same text Claude Code's `/context` renders: system prompt, tools, MCP
// tools, memory files, skills, messages, free space). `/context` is a LOCAL
// command — no model call, no tools, zero token cost (num_turns 0).
//
// Reuses `buildClaudeSdkOptions` so the report reflects the SAME context the
// session runs with (system-prompt preset, settingSources, MCP servers, model);
// `resume` includes the session's messages. Best-effort: a failure is logged
// and returns null (the UI falls back to the lightweight popover) — never throws.

import { query } from '../base/claude-agent-sdk.js'
import type { GetContextReportInput } from '../../shared/get-context-report-input.js'
import { buildClaudeSdkOptions } from '../base/build-claude-sdk-options.js'

export async function runClaudeContextReport(
  input: GetContextReportInput,
): Promise<string | null> {
  const options = buildClaudeSdkOptions({
    workspacePath: input.workspacePath,
    permissionMode: input.permissionMode,
    allowedToolNames: input.allowedToolNames,
    deniedToolNames: input.deniedToolNames,
    ...(input.resumeSessionId !== undefined ? { resumeSessionId: input.resumeSessionId } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.mcpServers !== undefined
      ? {
          mcpServers: input.mcpServers as Parameters<typeof buildClaudeSdkOptions>[0]['mcpServers'],
        }
      : {}),
  })
  options.maxTurns = 1
  // Ephemeral probe — /context must NOT write the session's JSONL (Vynel's
  // source-of-truth transcript, read by fetch-transcript + synchronize). The SDK
  // default (persistSession: true, forkSession: false) would persist a resumed
  // dispatch in place; persistSession:false makes it read-only.
  options.persistSession = false
  const abortController = new AbortController()
  options.abortController = abortController

  try {
    for await (const message of query({ prompt: '/context', options })) {
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
      'failed to read the /context report',
    )
    return null
  } finally {
    // Idempotent — a no-op if the query already completed.
    abortController.abort()
  }
}

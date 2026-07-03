// Reads a session's `/context` breakdown (raw markdown) via the provider —
// backs the chat context-detail panel. Thin: fetch the session's model, resolve
// the provider, dispatch getContextReport. Returns null when the provider has no
// `/context`-equivalent or the read fails (the UI falls back to the lightweight
// popover). See .claude/plans/chat-model-and-context-usage-research.md (#3).

import { resolveAiAgentProvider } from '@vynel/providers'
import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { AiAgentProviderId } from '@vynel/providers'
import type { StructuralLogger } from '../chat-types.js'

export type GetSessionContextReportInput = {
  providerId: AiAgentProviderId
  /** Workspace folder — the agent's cwd. */
  workspacePath: string
  /** The session whose context is reported (resumed so its messages count). */
  sessionId: string
  /** Pre-built MCP servers so the report counts MCP tools accurately. */
  mcpServers?: Record<string, unknown>
  allowedMcpToolPatterns?: string[]
}

export async function getSessionContextReport(
  db: Database,
  input: GetSessionContextReportInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<string | null> {
  const session = chatRepository.findChatSessionById(db, input.sessionId)
  const provider = resolveAiAgentProvider(input.providerId)
  return provider.getContextReport({
    workspacePath: input.workspacePath,
    resumeSessionId: input.sessionId,
    ...(session?.model ? { model: session.model } : {}),
    permissionMode: 'bypass-with-behavior-gate',
    allowedToolNames: [],
    deniedToolNames: [],
    ...(input.mcpServers !== undefined ? { mcpServers: input.mcpServers } : {}),
    ...(input.allowedMcpToolPatterns !== undefined
      ? { allowedMcpToolPatterns: input.allowedMcpToolPatterns }
      : {}),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  })
}

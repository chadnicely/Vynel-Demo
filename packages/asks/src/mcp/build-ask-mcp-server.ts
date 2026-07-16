// Builds the in-process `vynel-ask` MCP server — the one `ask_user` tool
// becomes `mcp__vynel-ask__ask_user`. A SEPARATE server from `vynel` because
// a route-derived tool cannot own an await (the blocking bridge lives in the
// handler). Mirrors `@vynel/instructions`' buildNotebookMcpServer shape.

import { createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { makeAskUserTool, type AskUserToolDeps, type AskUserToolScope } from './ask-user-tool.js'
import type { Database } from '@vynel/db'

export function buildAskMcpServer(
  db: Database,
  scope: AskUserToolScope,
  deps: AskUserToolDeps,
): ReturnType<typeof createSdkMcpServer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK widening at the factory boundary, matching the notebook server builder.
  const tools = [makeAskUserTool(db, scope, deps) as SdkMcpToolDefinition<any>]
  return createSdkMcpServer({
    name: 'vynel-ask',
    version: '1.0.0',
    tools,
  })
}

// Builds the in-process `vynel-session` MCP server — the session package's own
// tools: `whoami` today (`mcp__vynel-session__whoami`), the checkpoint tool next. A separate server (not a `vynel` route) on
// purpose: the answer is computed from the turn's OWN compose-time identity
// (`SessionToolContext.sessionId` = the stable primary id) — a route would need
// an ambient header the delegated background runners do not stamp, and the
// spawned / colleague sessions those runners drive are exactly the identities
// that most need to know who they are. Mirrors the `vynel-ask` /
// `vynel-notebook` server builders.

import { createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Database } from '@vynel/db'
import { makeWhoamiTool, type WhoamiToolScope } from './whoami-tool.js'

export const SESSION_MCP_SERVER_NAME = 'vynel-session'

export function buildSessionMcpServer(
  db: Database,
  scope: WhoamiToolScope,
): ReturnType<typeof createSdkMcpServer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK widening at the factory boundary, matching the notebook/ask server builders.
  const tools = [makeWhoamiTool(db, scope) as SdkMcpToolDefinition<any>]
  return createSdkMcpServer({
    name: SESSION_MCP_SERVER_NAME,
    version: '1.0.0',
    tools,
  })
}

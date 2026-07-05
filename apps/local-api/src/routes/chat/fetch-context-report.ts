// Builds the per-session in-process MCP server (so the /context report counts
// MCP tools accurately) and reads the session's context-window breakdown via the
// core op. Extracted from the route handler to keep it parse→call→shape; mirrors
// streams/chat-turn.ts's MCP-build pattern (mcp D5 + the api-side turn precedent).

import type { Context } from 'hono'
import { getSessionContextReport } from '@vynel/chat'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import type { AppEnv } from '../../factory.js'
import { composeSessionMcpServers } from '../../sessions/compose-session-mcp-servers.js'

export async function fetchSessionContextReport(c: Context<AppEnv>): Promise<string | null> {
  // Same MCP attachment the chat turn uses, so the /context report counts the
  // workspace tools accurately. Dynamic import keeps the SDK out of module load.
  const { vynelWorkspaceDescriptor } = await import('@vynel/mcp')
  const composedMcp = composeSessionMcpServers([vynelWorkspaceDescriptor], {
    db: c.var.db,
    userId: c.var.user.id,
    workspaceId: c.var.workspace!.id,
    appRequest: c.var.appRequest,
  })

  return getSessionContextReport(
    c.var.db,
    {
      providerId: DEFAULT_PROVIDER_ID,
      workspacePath: c.var.workspace!.path,
      sessionId: c.var.chatSession!.id,
      mcpServers: composedMcp.mcpServers,
      allowedMcpToolPatterns: composedMcp.allowedMcpToolPatterns,
    },
    { logger: c.var.logger },
  )
}

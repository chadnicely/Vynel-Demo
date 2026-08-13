// Builds the per-session in-process MCP server (so the /context report counts
// MCP tools accurately) and reads the session's context-window breakdown via the
// core op. Extracted from the route handler to keep it parse→call→shape; mirrors
// streams/chat-turn.ts's MCP-build pattern (mcp D5 + the api-side turn precedent).

import type { Context } from 'hono'
import { getSessionContextReport } from '@vynel/chat'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { listEnabledCapabilities } from '@vynel/capabilities'
import type { AppEnv } from '../../factory.js'
import { composeSessionMcpServers } from '../../sessions/compose-session-mcp-servers.js'
import { resolveEnabledFeatureKeys } from '../../sessions/enabled-feature-keys.js'
import { resolveSessionToolPolicies } from '../../sessions/session-tool-catalog.js'

export async function fetchSessionContextReport(c: Context<AppEnv>): Promise<string | null> {
  // Same MCP attachment the chat turn uses (streams/chat-turn.ts — descriptors
  // AND enabled-capability set), so the /context report counts the workspace +
  // notebook tools accurately — including the session-spawning tools the
  // INTERACTIVE stream carries (Slice ④b). Dynamic import keeps the SDK out of
  // module load.
  const { vynelWorkspaceInteractiveDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  const enabledCapabilityIds = new Set(
    listEnabledCapabilities(c.var.db, c.var.workspace!.id).map((capability) => capability.id),
  )
  const enabledFeatureKeys = resolveEnabledFeatureKeys(c.var.hubSession)
  const composedMcp = composeSessionMcpServers(
    [vynelWorkspaceInteractiveDescriptor, notebookFeatureDescriptor],
    {
      db: c.var.db,
      userId: c.var.user.id,
      workspaceId: c.var.workspace!.id,
      appRequest: c.var.appRequest,
    },
    {
      enabledCapabilityIds,
      ...(enabledFeatureKeys !== undefined ? { enabledFeatureKeys } : {}),
      // Mirror the chat turn's policy view so the report counts what the
      // turn will actually carry.
      toolPolicies: resolveSessionToolPolicies(c.var.db, { userId: c.var.user.id }),
      surfaceKind: 'workspace-interactive',
    },
  )

  return getSessionContextReport(
    c.var.db,
    {
      providerId: DEFAULT_PROVIDER_ID,
      workspacePath: c.var.workspace!.path,
      sessionId: c.var.chatSession!.id,
      mcpServers: composedMcp.mcpServers,
    },
    { logger: c.var.logger },
  )
}

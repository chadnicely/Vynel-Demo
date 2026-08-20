// Builds the in-process `vynel-session` MCP server — the session package's own
// tools: `whoami` (`mcp__vynel-session__whoami`) and `checkpoint`
// (`mcp__vynel-session__checkpoint`). A separate server (not a `vynel` route) on
// purpose: the answer is computed from the turn's OWN compose-time identity
// (`SessionToolContext.sessionId` = the stable primary id) — a route would need
// an ambient header the delegated background runners do not stamp, and the
// spawned / colleague sessions those runners drive are exactly the identities
// that most need to know who they are. Mirrors the `vynel-ask` /
// `vynel-notebook` server builders.

import { createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Database } from '@vynel/db'
import { makeWhoamiTool, type WhoamiToolScope } from './whoami-tool.js'
import { makeCheckpointTool } from './checkpoint-tool.js'

export const SESSION_MCP_SERVER_NAME = 'vynel-session'

export function buildSessionMcpServer(
  db: Database,
  scope: WhoamiToolScope,
): ReturnType<typeof createSdkMcpServer> {
  // WHERE THIS TURN BEGINS, for the checkpoint tool's supersession line: a
  // pending step older than this was left by an earlier turn, which this turn
  // never saw, so replacing it is said out loud. A turn's MCP attachment is
  // composed ONCE and reused across its automatic continuations, and every
  // `composeSessionMcpServers` site sits inside a turn — so this is compose
  // time, which the turn's execution follows. It PRECEDES execution when the
  // turn then waits on a session target lock: a step another turn leaves on the
  // same identity during that wait still reads as this turn's own. Far tighter
  // than the process-start line it replaced, and the residual needs two turns
  // overlapping in the compose→lock window.
  const turnStartedAt = new Date()
  const tools = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK widening at the factory boundary, matching the notebook/ask server builders.
    makeWhoamiTool(db, scope) as SdkMcpToolDefinition<any>,
    // The checkpoint keys on the same identity whoami describes.
    makeCheckpointTool(db, {
      turnStartedAt,
      ...(scope.primarySessionId !== undefined ? { primarySessionId: scope.primarySessionId } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same widening.
    }) as SdkMcpToolDefinition<any>,
  ]
  return createSdkMcpServer({
    name: SESSION_MCP_SERVER_NAME,
    version: '1.0.0',
    tools,
  })
}

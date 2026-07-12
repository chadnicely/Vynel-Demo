import { createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Database } from '@vynel/db'
import { makeListPlaybooksTool } from './list-playbooks-tool.js'
import { makeReadPlaybookTool } from './read-playbook-tool.js'
import type { PlaybookShelfScope } from './playbook-shelf.js'

// Builds the in-process `vynel-notebook` MCP server — tools become
// `mcp__vynel-notebook__*`. A SEPARATE server from `vynel` (route-derived
// tools) because the notebook has no HTTP routes yet (next slice), so it
// can't be generated from an `x-mcp` route annotation. Mirrors
// `@vynel/desktop-control`'s `buildDesktopMcpServer` shape.
//
// READ-ONLY BY DESIGN (settled fork #1: "claude can make mistakes") — the
// model lists and reads books; it never writes one. Users author their own
// documents through the UI; verified books ship from the repo directory.
export function buildNotebookMcpServer(
  db: Database,
  scope: PlaybookShelfScope,
): ReturnType<typeof createSdkMcpServer> {
  const factories: unknown[] = [
    makeListPlaybooksTool(db, scope),
    makeReadPlaybookTool(db, scope),
  ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK widening at the factory boundary, matching @vynel/mcp's buildInProcessMcpServer.
  const tools = factories.map((toolDefinition) => toolDefinition as SdkMcpToolDefinition<any>)
  return createSdkMcpServer({
    name: 'vynel-notebook',
    version: '1.0.0',
    tools,
  })
}

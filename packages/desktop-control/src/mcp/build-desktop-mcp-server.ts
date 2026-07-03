import { createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { DesktopNotificationReader } from '../notifications/desktop-notification.js'
import { makeListDesktopNotificationsTool } from './list-desktop-notifications-tool.js'
import { makeListOpenAppsTool } from './list-open-apps-tool.js'
import { makeSnapshotAppTool } from './snapshot-app-tool.js'
import { makeActOnAppTool } from './act-on-app-tool.js'

export type BuildDesktopMcpServerInput = {
  reader: DesktopNotificationReader
  /**
   * Enable the MUTATING `act_on_app` tool (click / type / set value). Default
   * OFF — a real off-switch so a stray merge or run can't silently act on the
   * desktop. The hard approval gate is a SEPARATE end-step (owned by the
   * approvals work); until it lands, the interim safety for `act` is the
   * isolated environment + this flag, NOT the prompt instruction. See
   * `[[desktop-control-mcp-server]]`.
   */
  enableActions?: boolean
}

// Builds the in-process `desktop` MCP server — tools become `mcp__desktop__*`.
// A SEPARATE server from `vynel` (route-derived tools) because desktop control
// touches the OS, not a Vynel HTTP route, so it can't be generated from an
// `x-mcp` route annotation. Mirrors `@vynel/mcp`'s `buildInProcessMcpServer`
// shape. Forwarded into the SDK session's `options.mcpServers` alongside the
// other servers. See decision `[[desktop-control-mcp-server]]`.
//
// Read-only tools always: list_desktop_notifications · list_open_apps ·
// snapshot_app. The MUTATING act_on_app is included ONLY when `enableActions`
// is true (default off).
export function buildDesktopMcpServer(
  input: BuildDesktopMcpServerInput,
): ReturnType<typeof createSdkMcpServer> {
  const factories: unknown[] = [
    makeListDesktopNotificationsTool(input.reader),
    makeListOpenAppsTool(),
    makeSnapshotAppTool(),
  ]
  if (input.enableActions === true) {
    factories.push(makeActOnAppTool())
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK widening at the factory boundary, matching @vynel/mcp's buildInProcessMcpServer.
  const tools = factories.map((toolDefinition) => toolDefinition as SdkMcpToolDefinition<any>)
  return createSdkMcpServer({
    name: 'desktop',
    version: '1.0.0',
    tools,
  })
}

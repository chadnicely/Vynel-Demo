import { createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Database } from '@vynel/db'
import type { DesktopNotificationReader } from '../notifications/desktop-notification.js'
import { makeDesktopAccessAuthorizer } from '../access/assert-desktop-access.js'
import { normalizeDesktopAppKey } from '../access/desktop-access-tiers.js'
import { findDesktopAppGrant } from '../repositories/desktop-app-grants.js'
import { makeListDesktopNotificationsTool } from './list-desktop-notifications-tool.js'
import { makeListOpenAppsTool } from './list-open-apps-tool.js'
import { makeSnapshotAppTool } from './snapshot-app-tool.js'
import { makeScreenshotAppTool } from './screenshot-app-tool.js'
import { makeActOnAppTool } from './act-on-app-tool.js'
import { makeActOnDesktopTool } from './act-on-desktop-tool.js'
import { makeRequestDesktopAccessTool } from './request-desktop-access-tool.js'

export type BuildDesktopMcpServerInput = {
  reader: DesktopNotificationReader
  /** The session's db + user — the per-app access grants are enforced against these. */
  db: Database
  userId: string
  /**
   * Enable the MUTATING `act_on_app` / `act_on_desktop` tools. Default OFF — a
   * real off-switch so a stray merge or run can't silently act on the desktop.
   * With actions ON, every action still passes the per-app access gate: no
   * grant row (user consent via `request_desktop_access`) = no action.
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
// The access model (Claude-desktop-style per-app tiers): EVERY app-directed
// tool — snapshot/screenshot (read) and the act tools (click/full) — resolves
// its target app first and enforces the user's grant for THAT app via the
// authorizer. `request_desktop_access` (registered always; carded in every
// mode) is the only way a grant comes into being. `list_open_apps` (names
// only) and `list_desktop_notifications` (redacted at ingest) stay ungated.
/** The turn's tool set — exported so tests can assert registration without
 *  reaching into the live McpServer instance. */
export function desktopToolFactories(input: BuildDesktopMcpServerInput): unknown[] {
  const authorize = makeDesktopAccessAuthorizer(input.db, input.userId)
  const readGrantedTier = (appName: string) =>
    findDesktopAppGrant(input.db, input.userId, normalizeDesktopAppKey(appName))?.tier ?? null
  const factories: unknown[] = [
    makeListDesktopNotificationsTool(input.reader),
    makeListOpenAppsTool(readGrantedTier),
    makeSnapshotAppTool(authorize),
    makeScreenshotAppTool(authorize),
    // Registered even with actions OFF — the read tools are grant-gated too,
    // so the consent path must always exist.
    makeRequestDesktopAccessTool(input.db, input.userId),
  ]
  if (input.enableActions === true) {
    factories.push(makeActOnAppTool(authorize))
    factories.push(makeActOnDesktopTool(authorize))
  }
  return factories
}

export function buildDesktopMcpServer(
  input: BuildDesktopMcpServerInput,
): ReturnType<typeof createSdkMcpServer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK widening at the factory boundary, matching @vynel/mcp's buildInProcessMcpServer.
  const tools = desktopToolFactories(input).map((toolDefinition) => toolDefinition as SdkMcpToolDefinition<any>)
  return createSdkMcpServer({
    name: 'desktop',
    version: '1.0.0',
    tools,
  })
}

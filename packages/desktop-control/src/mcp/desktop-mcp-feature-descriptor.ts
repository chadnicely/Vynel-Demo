// The `desktop` MCP feature descriptor — the standalone (non-route-derived)
// desktop server expressed as the shared `McpFeatureDescriptor` so the apps/local-api
// composer attaches it to a turn the same way it attaches `vynel`. This is what
// lets the global-root brain carry its desktop senses on EVERY channel (web +
// channel + voice) from one declaration, instead of being hand-wired into one
// turn file (the divergence the composer closes).
//
// `@vynel/desktop-control` stays core-free: its only new dependency is the
// dependency-light `@vynel/mcp-contract` (which has no `@vynel/*` deps). The
// contract types `desktopReader` as `unknown`; this is the producer boundary
// that owns the desktop server, so it casts to `DesktopNotificationReader` once.

import type { McpFeatureDescriptor, SessionToolContext, SessionMcpServer } from '@vynel/mcp-contract'
import type { DesktopNotificationReader } from '../notifications/desktop-notification.js'
import { buildDesktopMcpServer } from './build-desktop-mcp-server.js'
import { DESKTOP_TOOL_INSTRUCTIONS, DESKTOP_ACT_INSTRUCTIONS } from './desktop-tool-instructions.js'

function build(context: SessionToolContext): SessionMcpServer | null {
  // No process-wide listener (tests / off-Windows / idle) → the feature is not
  // applicable to this turn; the composer skips it (no server, no allow pattern,
  // no mutating-name contribution).
  if (context.desktopReader === undefined) return null
  return buildDesktopMcpServer({
    // The one documented producer-boundary cast — see file header.
    reader: context.desktopReader as DesktopNotificationReader,
    enableActions: context.enableDesktopActions ?? false,
  })
}

// Only called by the composer AFTER `build` returned a server (reader present),
// so the contribution is unconditional on the reader; the act instructions
// append only when actions are enabled (mirrors the registered toolset).
function contributePrompt(context: SessionToolContext): string {
  return context.enableDesktopActions === true
    ? `${DESKTOP_TOOL_INSTRUCTIONS}\n\n${DESKTOP_ACT_INSTRUCTIONS}`
    : DESKTOP_TOOL_INSTRUCTIONS
}

// Read-only desktop observation always; the MUTATING `act_on_app` is registered
// only when `enableDesktopActions` is on (default-off). `act_on_app` is declared
// here so that — once the composer feeds `mutatingToolNames` into the approval
// backstop — it cards automatically whenever it IS present, closing the spec'd
// act-approval gap by the same general mechanism as every other mutating tool.
export const desktopFeatureDescriptor: McpFeatureDescriptor = {
  serverName: 'desktop',
  build,
  mutatingToolNames: ['mcp__desktop__act_on_app', 'mcp__desktop__act_on_desktop'],
  contributePrompt,
}

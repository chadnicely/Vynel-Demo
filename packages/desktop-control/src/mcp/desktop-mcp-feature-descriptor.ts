// The `desktop` MCP feature descriptor — the standalone (non-route-derived)
// desktop server expressed as the shared `McpFeatureDescriptor` so the apps/local-api
// composer attaches it to a turn the same way it attaches `vynel`. This is what
// lets the global-root brain carry its desktop senses on EVERY channel (web +
// channel + voice) from one declaration, instead of being hand-wired into one
// turn file (the divergence the composer closes).
//
// `@vynel/desktop-control` stays core-free (kernel + shared only — `@vynel/db`
// for the access grants, `@vynel/errors`, and the dependency-light
// `@vynel/mcp-contract`). The contract types `desktopReader` and `db` as
// `unknown`; this is the producer boundary that owns the desktop server, so it
// casts each once.

import type { McpFeatureDescriptor, SessionToolContext, SessionMcpServer } from '@vynel/mcp-contract'
import type { Database } from '@vynel/db'
import type { DesktopNotificationReader } from '../notifications/desktop-notification.js'
import { buildDesktopMcpServer } from './build-desktop-mcp-server.js'
import { DESKTOP_TOOL_INSTRUCTIONS, DESKTOP_ACT_INSTRUCTIONS } from './desktop-tool-instructions.js'

function build(context: SessionToolContext): SessionMcpServer | null {
  // No process-wide listener (tests / off-Windows / idle) → the feature is not
  // applicable to this turn; the composer skips it (no server, no allow pattern,
  // no mutating-name contribution).
  if (context.desktopReader === undefined) return null
  return buildDesktopMcpServer({
    // The documented producer-boundary casts — see file header.
    reader: context.desktopReader as DesktopNotificationReader,
    db: context.db as Database,
    userId: context.userId,
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

// Read-only desktop observation always; the MUTATING act tools are registered
// only when `enableDesktopActions` is on (default-off). The act tools ride the
// ASK-approval tier, not the every-mode set — Chad 2026-07-26: "ask mode gates
// through approval; auto and bypass, no approval" (they previously carded in
// every mode). `request_desktop_access` sits in the MUTATING tier because it
// is the user-consent moment of the per-app access model: it cards in ASK and
// in the UNATTENDED `bypass-with-behavior-gate` default (a background turn
// must never grant itself desktop reach silently). In the user's own AUTO and
// BYPASS the floor stands down and it runs uncarded — Chad 2026-08-04:
// "auto, bypass doesn't require card; ask requires card." Declared
// unconditionally: the tiers are additive, so declaring a tool that isn't
// registered this turn is harmless.
export const desktopFeatureDescriptor: McpFeatureDescriptor = {
  serverName: 'desktop',
  build,
  mutatingToolNames: ['mcp__desktop__request_desktop_access'],
  askModeApprovalToolNames: ['mcp__desktop__act_on_app', 'mcp__desktop__act_on_desktop'],
  contributePrompt,
}

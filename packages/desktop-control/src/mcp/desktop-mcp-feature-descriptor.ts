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
    planConsent: context.desktopPlanConsent ?? 'display-only',
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
// only when `enableDesktopActions` is on (default-off). PLAN-LEVEL APPROVAL
// (Kafi 2026-08-11): the ask-approval tier holds `propose_desktop_plan` — the
// ONE card of a desktop task — and the act tools left it: they are gated
// in-tool by the plan envelope instead (no armed plan → refusal, in every
// mode), so an approved plan runs its steps card-free. In auto/bypass the plan
// runs uncarded (those modes are the standing consent); on unattended turns it
// runs uncarded but 'display-only'. `request_desktop_access` sits in the
// MUTATING tier because it is the STANDING-grant consent moment: it cards in
// ASK and in the UNATTENDED `bypass-with-behavior-gate` default (a background
// turn must never grant itself desktop reach silently). In the user's own AUTO
// and BYPASS the floor stands down and it runs uncarded — Chad 2026-08-04:
// "auto, bypass doesn't require card; ask requires card." Declared
// unconditionally: the tiers are additive, so declaring a tool that isn't
// registered this turn is harmless.
export const desktopFeatureDescriptor: McpFeatureDescriptor = {
  serverName: 'desktop',
  build,
  mutatingToolNames: ['mcp__desktop__request_desktop_access'],
  askModeApprovalToolNames: ['mcp__desktop__propose_desktop_plan'],
  contributePrompt,
}

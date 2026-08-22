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
import { listRecentDesktopActionsForSession } from '../repositories/desktop-actions.js'
import { buildDesktopMcpServer } from './build-desktop-mcp-server.js'
import { buildDesktopContinuationPrompt } from './desktop-continuation-prompt.js'
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
    // Vynel's stable session id + the grounding workspace — what the action
    // record keys "how far did THAT task get" by. Conditional spreads:
    // `exactOptionalPropertyTypes` distinguishes absent from undefined.
    ...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
    ...(context.workspaceId !== undefined ? { workspaceId: context.workspaceId } : {}),
    enableActions: context.enableDesktopActions ?? false,
    planConsent: context.desktopPlanConsent ?? 'display-only',
  })
}

// The turn-start read behind "last time I got as far as X, shall I carry on?".
// Sync on purpose — the SQLite read is sync and `contributePrompt` is a sync
// seam. A failed read drops the section rather than failing composition: the
// same trade `recordAct` documents — a log surface that can break the turn it
// serves is worse than a missing section (and if the db is truly down, the
// turn's first tool call will say so loudly). Dropped WITHOUT a log line only
// because `SessionToolContext` carries no logger and `@vynel/logger` is an
// injection-only contract — when the context gains one, warn here.
function readContinuationSection(context: SessionToolContext): string | null {
  if (context.sessionId === undefined) return null
  try {
    const rows = listRecentDesktopActionsForSession(
      context.db as Database,
      context.userId,
      context.sessionId,
    )
    return buildDesktopContinuationPrompt(rows, new Date())
  } catch {
    return null
  }
}

// Only called by the composer AFTER `build` returned a server (reader present),
// so the contribution is unconditional on the reader; the act instructions
// append only when actions are enabled (mirrors the registered toolset).
function contributePrompt(context: SessionToolContext): string {
  const instructions =
    context.enableDesktopActions === true
      ? `${DESKTOP_TOOL_INSTRUCTIONS}\n\n${DESKTOP_ACT_INSTRUCTIONS}`
      : DESKTOP_TOOL_INSTRUCTIONS
  const continuation = readContinuationSection(context)
  return continuation === null ? instructions : `${instructions}\n\n${continuation}`
}

// Read-only desktop observation always; the MUTATING act tools are registered
// only when `enableDesktopActions` is on (default-off).
//
// APPROVAL, as of 2026-08-13: there is exactly ONE card in a desktop task, and
// it is the PLAN. `askModeApprovalToolNames` holds `propose_desktop_plan`, so
// in ask mode the user approves the whole plan once and its steps then run
// card-free; in auto/bypass it runs uncarded (those modes ARE the standing
// consent); on an unattended turn it arms 'display-only' and authorizes
// nothing at all.
//
// `mutatingToolNames` is EMPTY, and that is the change. It is the every-mode
// approval FLOOR, and it used to hold `request_desktop_access` — the
// standing-grant consent moment, which had to card even in the unattended
// default so a background turn could never grant itself desktop reach. Per-app
// grants are retired, that tool no longer exists, and nothing else in this
// package needs an every-mode card: acting is authorized by the plan, and the
// plan cards in ask mode above.
export const desktopFeatureDescriptor: McpFeatureDescriptor = {
  serverName: 'desktop',
  // The FULL declared surface (12 read + 11 act). A read-only context
  // registers only the first 12 — the inventory is the legible policy/admin
  // surface; the built server stays the executable truth.
  toolNames: [
    'mcp__desktop__list_desktop_notifications',
    'mcp__desktop__list_open_apps',
    'mcp__desktop__list_installed_apps',
    'mcp__desktop__list_monitors',
    'mcp__desktop__system_status',
    'mcp__desktop__get_app',
    'mcp__desktop__mouse_position',
    'mcp__desktop__snapshot_app',
    'mcp__desktop__screenshot_app',
    'mcp__desktop__screenshot_desktop',
    'mcp__desktop__wait_for',
    'mcp__desktop__send_desktop_notification',
    'mcp__desktop__propose_desktop_plan',
    'mcp__desktop__act_on_app',
    'mcp__desktop__act_on_desktop',
    'mcp__desktop__launch_app',
    'mcp__desktop__open_url',
    'mcp__desktop__set_window_state',
    'mcp__desktop__focus_window',
    'mcp__desktop__set_window_bounds',
    'mcp__desktop__read_clipboard',
    'mcp__desktop__write_clipboard',
    'mcp__desktop__set_volume',
  ],
  build,
  // EMPTY, deliberately. This list is the every-mode approval FLOOR, and it
  // named `request_desktop_access` — a tool that no longer exists. Nothing in
  // this package cards in every mode now: acting is authorized by the plan, and
  // the plan itself cards in ask mode via `askModeApprovalToolNames` below.
  mutatingToolNames: [],
  askModeApprovalToolNames: ['mcp__desktop__propose_desktop_plan'],
  contributePrompt,
}

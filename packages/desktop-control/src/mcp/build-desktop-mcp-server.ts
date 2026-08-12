import { createSdkMcpServer, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Database } from '@vynel/db'
import type { DesktopPlanConsent } from '@vynel/mcp-contract'
import type { DesktopNotificationReader } from '../notifications/desktop-notification.js'
import { createDesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { makeListDesktopNotificationsTool } from './list-desktop-notifications-tool.js'
import { makeListOpenAppsTool } from './list-open-apps-tool.js'
import { makeListInstalledAppsTool } from './list-installed-apps-tool.js'
import { makeListMonitorsTool } from './list-monitors-tool.js'
import { makeSystemStatusTool } from './system-status-tool.js'
import { makeGetAppTool } from './get-app-tool.js'
import { makeReadClipboardTool, makeWriteClipboardTool } from './clipboard-tools.js'
import { makeLaunchAppTool } from './launch-app-tool.js'
import { makeSetWindowStateTool } from './set-window-state-tool.js'
import { makeSnapshotAppTool } from './snapshot-app-tool.js'
import { makeWaitForTool } from './wait-for-tool.js'
import { makeSetWindowBoundsTool } from './set-window-bounds-tool.js'
import { makeScreenshotAppTool } from './screenshot-app-tool.js'
import { makeActOnAppTool } from './act-on-app-tool.js'
import { makeActOnDesktopTool } from './act-on-desktop-tool.js'
import { makeProposeDesktopPlanTool } from './propose-desktop-plan-tool.js'

export type BuildDesktopMcpServerInput = {
  reader: DesktopNotificationReader
  /** Kept for the descriptor's uniform construction shape; no tool reads them
   *  now that the package owns no tables. */
  db: Database
  userId: string
  /**
   * Enable the MUTATING `act_on_app` / `act_on_desktop` tools. Default OFF — a
   * real off-switch so a stray merge or run can't silently act on the desktop.
   * With actions ON, every action still passes the PLAN gate: no app named in
   * the turn's approved plan = no action on it.
   */
  enableActions?: boolean
  /**
   * How this turn's proposed plan acquires authority (mode-derived by the
   * caller via `deriveDesktopPlanConsent`). Default 'display-only' — the
   * conservative floor: a caller that forgets to thread it gets a plan that
   * narrates on the overlay but authorizes nothing at all.
   */
  planConsent?: DesktopPlanConsent
}

// Builds the in-process `desktop` MCP server — tools become `mcp__desktop__*`.
// A SEPARATE server from `vynel` (route-derived tools) because desktop control
// touches the OS, not a Vynel HTTP route, so it can't be generated from an
// `x-mcp` route annotation. Mirrors `@vynel/mcp`'s `buildInProcessMcpServer`
// shape. Forwarded into the SDK session's `options.mcpServers` alongside the
// other servers. See decision `[[desktop-control-mcp-server]]`.
//
// THE ACCESS MODEL, as of 2026-08-13 (Kafi's call): the PLAN is the only
// authority, and it covers ACTING only.
//
//   looking  (list_*, snapshot, screenshot, wait_for)  -> ungated, no overlay
//   acting   (act_*, launch, window state/bounds, clipboard) -> plan + overlay
//
// Per-app grants and `request_desktop_access` are gone. They asked a second
// time for consent the plan already carries, in a vocabulary a non-technical
// user cannot evaluate — the cards this package generated in practice said
// "Docker Desktop Launcher" and "Application Frame Host". A plan that says
// "open Docker and check whether the containers are running" is consent someone
// can actually give, and the overlay narrates the acting as it happens.
/** The turn's tool set — exported so tests can assert registration without
 *  reaching into the live McpServer instance. */
export function desktopToolFactories(input: BuildDesktopMcpServerInput): unknown[] {
  const factories: unknown[] = [
    makeListDesktopNotificationsTool(input.reader),
    makeListOpenAppsTool(),
    // Names only, like list_open_apps — knowing an app exists grants nothing.
    makeListInstalledAppsTool(),
    makeListMonitorsTool(),
    // LOOKING is ungated. Reading needs no plan (you often have to look before
    // you can plan), and per-app grants — its only other gate — are gone: they
    // asked a second time for consent the plan already carries, in a vocabulary
    // a non-technical user cannot evaluate. Nothing here changes the screen.
    // The MACHINE's own vitals rather than any app's — no target to resolve,
    // and the answer to "why is my computer slow" is several of these numbers
    // together, which is why it is one tool and not four.
    makeSystemStatusTool(),
    // ONE app's state, and the only tool here that truly touches nothing —
    // screenshot_app restores a minimized window to capture it, so this is how
    // the model can find that out BEFORE it happens rather than after.
    makeGetAppTool(),
    makeSnapshotAppTool(),
    makeScreenshotAppTool(),
    makeWaitForTool(),
  ]
  if (input.enableActions === true) {
    // ONE envelope shared by the plan tool and both act tools — that shared
    // instance is the whole plan-approval mechanism: propose arms it, acts
    // refuse without it. Server instances are per-turn, so the plan (and
    // whatever its approval authorized) dies with the turn.
    const envelope = createDesktopPlanEnvelope(input.planConsent ?? 'display-only')
    factories.push(makeProposeDesktopPlanTool(envelope))
    factories.push(makeActOnAppTool(envelope))
    factories.push(makeActOnDesktopTool(envelope))
    // Starting a program is an action — same envelope, same authorizer.
    factories.push(makeLaunchAppTool(envelope))
    // Arranging a window (maximize / minimize / restore) is a click-class
    // action — same envelope, same authorizer.
    factories.push(makeSetWindowStateTool(envelope))
    // Moving/resizing is the same click-class change as arranging state, and the
    // correct primitive for "put this on my other screen" — dragging a title bar
    // across a monitor boundary is slow and fails invisibly.
    factories.push(makeSetWindowBoundsTool(envelope))
    // The clipboard is GLOBAL, not app-scoped, so the per-app authorizer has
    // nothing to check it against — the plan envelope is its only gate, which
    // is why even the READ lives behind `enableActions` (it can surface a
    // password the user copied moments ago). See `clipboard-tools.ts`.
    factories.push(makeReadClipboardTool(envelope))
    factories.push(makeWriteClipboardTool(envelope))
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

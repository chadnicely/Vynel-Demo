import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpToolFn } from './mcp-tool-fn.js'
import { listOpenApps, type OpenApp } from '../a11y/xa11y-adapter.js'
import type { DesktopAccessTier } from '../access/desktop-access-tiers.js'

const TOOL_DESCRIPTION =
  'List the desktop apps/windows currently open that you can target for desktop control. Returns each ' +
  "app's name (the title to pass to snapshot_app and desktop actions), its pid, and accessTier — the " +
  'tier the user has granted you for that app ("read" = look, "click" = also press, "full" = also type, ' +
  '"none" = no access yet; use request_desktop_access to ask). READ-ONLY. Call this FIRST to discover ' +
  'what to target — do not guess window titles, which are dynamic (e.g. "*Notes.txt - Notepad"). ' +
  'Windows only today; returns an empty list on other platforms.'

/** Reads the granted tier for a resolved app name; null = no grant. Bound to
 *  the session's db + user by the server builder. */
export type ReadGrantedTier = (appName: string) => DesktopAccessTier | null

export function buildListOpenAppsResponse(
  apps: OpenApp[],
  readGrantedTier?: ReadGrantedTier,
): {
  content: Array<{ type: 'text'; text: string }>
} {
  const annotated = apps.map((app) => ({
    ...app,
    accessTier: readGrantedTier?.(app.name) ?? 'none',
  }))
  return {
    content: [
      { type: 'text', text: JSON.stringify({ count: annotated.length, apps: annotated }, null, 2) },
    ],
  }
}

/** Construct the read-only `list_open_apps` SDK MCP tool. */
export function makeListOpenAppsTool(): unknown {
  return (tool as unknown as McpToolFn)(
    'list_open_apps',
    TOOL_DESCRIPTION,
    {},
    async () => {
      try {
        return buildListOpenAppsResponse(await listOpenApps())
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )
}

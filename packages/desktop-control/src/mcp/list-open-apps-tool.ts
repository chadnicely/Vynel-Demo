import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpToolFn } from '@vynel/mcp-contract'
import { listOpenApps, type OpenApp } from '../a11y/xa11y-adapter.js'

// The `accessTier` column is GONE with the per-app grant model (2026-08-13).
// It survived the removal for one commit, defaulting to "none" for every app on
// every turn while its description told the model to fix that with
// `request_desktop_access` — a tool that no longer exists. A uniformly false
// field on the tool the instructions say to call FIRST is worse than no field.
// There is nothing to report in its place: looking is ungated, and what may be
// ACTED on is whatever the turn's approved plan names.
const TOOL_DESCRIPTION =
  'List the desktop apps/windows currently open that you can target for desktop control. Returns each ' +
  "app's name (the title to pass to snapshot_app and the act tools) and its pid. READ-ONLY, and no " +
  'permission is needed to look. Call this FIRST to discover what to target — do not guess window ' +
  'titles, which are dynamic (e.g. "*Notes.txt - Notepad"). To ACT on one of these, name it in a plan ' +
  '(propose_desktop_plan). Windows only today; returns an empty list on other platforms.'

export function buildListOpenAppsResponse(apps: OpenApp[]): {
  content: Array<{ type: 'text'; text: string }>
} {
  return {
    content: [{ type: 'text', text: JSON.stringify({ count: apps.length, apps }, null, 2) }],
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

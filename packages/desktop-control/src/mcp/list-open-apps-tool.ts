import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpToolFn } from './mcp-tool-fn.js'
import { listOpenApps, type OpenApp } from '../a11y/xa11y-adapter.js'

const TOOL_DESCRIPTION =
  'List the desktop apps/windows currently open that you can target for desktop control. Returns each ' +
  "app's name (the title to pass to snapshot_app and desktop actions) and its pid. READ-ONLY. Call this " +
  'FIRST to discover what to target — do not guess window titles, which are dynamic (e.g. ' +
  '"*Notes.txt - Notepad"). Windows only today; returns an empty list on other platforms.'

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

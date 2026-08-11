import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import {
  listInstalledApps,
  matchInstalledApps,
  type InstalledApp,
} from '../apps/installed-apps.js'

// The roster of what's INSTALLED (vs `list_open_apps`, what's running). Kept
// read-only and ungated for the same reason `list_open_apps` is: it returns
// names, not access. Acting on anything found here still needs the plan
// envelope or a standing grant, and launching needs `launch_app`.

const TOOL_DESCRIPTION =
  'List the apps INSTALLED on this computer (Start menu), whether or not they are running — use this ' +
  "when the app you need isn't in list_open_apps, then launch_app to start it. Each entry has a name " +
  '(pass that exact NAME to launch_app — not the appId, which is the internal Windows id). Optional `query` filters by name, ranked ' +
  'best-first — pass one whenever you know what you are looking for, so you get a short list instead ' +
  'of everything. READ-ONLY. Windows only; returns an empty list elsewhere.'

// A full Start menu can run to hundreds of entries — an unfiltered dump would
// bury the model (and the turn's context) for no benefit.
const MAX_RESULTS = 60

export function buildInstalledAppsResponse(
  apps: InstalledApp[],
  query: string | undefined,
): { content: Array<{ type: 'text'; text: string }> } {
  const matched = query !== undefined && query.length > 0 ? matchInstalledApps(apps, query) : apps
  const shown = matched.slice(0, MAX_RESULTS)
  const payload = {
    count: shown.length,
    // Silence is not an option: a truncated list must SAY it was truncated, or
    // the model reads "not installed" from "not shown".
    ...(matched.length > shown.length
      ? { truncated: matched.length - shown.length, hint: 'Narrow the search with "query".' }
      : {}),
    ...(query !== undefined && query.length > 0 && matched.length === 0
      ? { note: `Nothing installed matches "${query}". Try a shorter or different name.` }
      : {}),
    apps: shown,
  }
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

export type ListInstalledAppsToolDeps = {
  listApps?: () => Promise<InstalledApp[]>
}

/** Construct the read-only `list_installed_apps` SDK MCP tool. */
export function makeListInstalledAppsTool(deps: ListInstalledAppsToolDeps = {}): unknown {
  const listApps = deps.listApps ?? (() => listInstalledApps())
  return (tool as unknown as McpToolFn)(
    'list_installed_apps',
    TOOL_DESCRIPTION,
    {
      query: z
        .string()
        .optional()
        .describe('Filter by name (case-insensitive), ranked best-first. Omit to list everything.'),
    },
    async (args: Record<string, unknown>) => {
      try {
        const query = typeof args['query'] === 'string' ? args['query'].trim() : undefined
        return buildInstalledAppsResponse(await listApps(), query)
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

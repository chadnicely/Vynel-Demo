// `get_app` — one app's state, without touching it.
//
// READ-ONLY in the strict sense: unlike `screenshot_app`, which restores a
// minimized window so there is something to capture, this changes nothing. That
// is the point. "Is Discord minimized?" used to be answerable only by
// capturing Discord, which un-minimized it — so looking altered the thing being
// looked at, and nothing said so.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from '@vynel/mcp-contract'
import { describeAppState, readAppState, type AppState } from '../a11y/app-state.js'

const TOOL_DESCRIPTION =
  'What state ONE app is in — not running, hidden in the system tray, open but minimized, or open ' +
  'and visible (with its size, position, and whether it is the window the user is actually looking ' +
  'at). READ-ONLY and it changes NOTHING: it will not restore, focus or disturb anything, which is ' +
  'what makes it safe to call first. Use it before screenshot_app or the act tools when you need to ' +
  'know what you are dealing with — screenshot_app RESTORES a minimized window, so checking here ' +
  'first is how you know that is about to happen and can tell the user. Cheaper and more precise ' +
  'than list_open_apps when you already know which app you mean.'

export type GetAppToolDeps = { read?: (query: string) => Promise<AppState> }

/** Construct the read-only `get_app` SDK MCP tool. */
export function makeGetAppTool(deps: GetAppToolDeps = {}): unknown {
  const read = deps.read ?? ((query: string) => readAppState(query))
  return (tool as unknown as McpToolFn)(
    'get_app',
    TOOL_DESCRIPTION,
    {
      app: z
        .string()
        .min(1)
        .describe('The app to check (name or a distinctive part of it, or its window title).'),
    },
    async (args: Record<string, unknown>) => {
      const query = typeof args['app'] === 'string' ? args['app'].trim() : ''
      if (query.length === 0) {
        return { content: [{ type: 'text', text: 'An "app" is required.' }], isError: true }
      }
      try {
        return { content: [{ type: 'text', text: describeAppState(await read(query)) }] }
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

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import { snapshotApp } from '../a11y/xa11y-adapter.js'

const TOOL_DESCRIPTION =
  "Read a desktop app's on-screen UI as an indented accessibility tree (roles, names, values) — your " +
  '"eyes" for desktop control. Pass `app` = the app/window name, or a distinctive part of it ' +
  '(case-insensitive; match list_open_apps first). It changes no app data. NOTE: reading a web-based ' +
  '(Electron) app such as Discord or Slack briefly brings its window to the FOREGROUND — that is required ' +
  'to wake its accessibility tree; native apps are read without disturbing focus. Use the roles and ' +
  'names you see here to drive a desktop action later (a button shown as `button "Save"` is targeted as ' +
  '`button[name="Save"]`). Windows only today. PRIVACY: this reads whatever is on that app\'s screen — ' +
  'only snapshot an app the user has asked you to work with, never to browse for secrets.'

export function buildSnapshotAppResponse(
  appQuery: string,
  tree: string,
): { content: Array<{ type: 'text'; text: string }> } {
  const body = tree.trim().length > 0 ? tree : '(the app exposed no accessibility tree)'
  return { content: [{ type: 'text', text: `Accessibility tree for "${appQuery}":\n\n${body}` }] }
}

/** Construct the read-only `snapshot_app` SDK MCP tool. */
export function makeSnapshotAppTool(): unknown {
  return (tool as unknown as McpToolFn)(
    'snapshot_app',
    TOOL_DESCRIPTION,
    {
      app: z
        .string()
        .describe('The app/window name to read, or a distinctive substring of it (case-insensitive).'),
      maxDepth: z
        .number()
        .int()
        .positive()
        .max(40)
        .optional()
        .describe('Max accessibility-tree depth to read. Default 12 (20 for Electron apps), capped at 40.'),
    },
    async (args: Record<string, unknown>) => {
      try {
        const app = typeof args['app'] === 'string' ? args['app'] : ''
        const maxDepth = typeof args['maxDepth'] === 'number' ? args['maxDepth'] : undefined
        const tree = await snapshotApp(app, maxDepth !== undefined ? { maxDepth } : {})
        return buildSnapshotAppResponse(app, tree)
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    // readOnlyHint: true — snapshot changes no app DATA. Reading an Electron app
    // briefly foregrounds its window to wake its tree (a visible side effect,
    // disclosed in the description above), but that is not a data mutation.
    { annotations: { readOnlyHint: true } },
  )
}

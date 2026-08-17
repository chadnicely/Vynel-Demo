import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from '@vynel/mcp-contract'
import { snapshotApp, type AppSnapshot } from '../a11y/xa11y-adapter.js'

const TOOL_DESCRIPTION =
  "Read a desktop app's on-screen UI as an indented accessibility tree (roles, names, values) — your " +
  '"eyes" for desktop control. Pass `app` = the app/window name, or a distinctive part of it ' +
  '(case-insensitive; match list_open_apps first). It changes no app data. NOTE: reading a web-based ' +
  '(Electron) app such as Discord or Slack briefly brings its window to the FOREGROUND — that is required ' +
  'to wake its accessibility tree; native apps are read without disturbing focus. Use the roles and ' +
  'names you see here to drive a desktop action later (a button shown as `button "Save"` is targeted as ' +
  '`button[name="Save"]`). Windows only today. PRIVACY: this reads whatever is on that app\'s screen — ' +
  'only snapshot an app the user has asked you to work with, never to browse for secrets.'

// Turn the wake outcome into actionable guidance instead of a bare empty tree —
// the model (and through it the user) learns exactly what to do next.
function describeEmptyTree(appQuery: string, snapshot: AppSnapshot): string {
  if (snapshot.wakeIncomplete && snapshot.focusSucceeded === false) {
    return (
      `(the app exposed no accessibility tree — its window refused focus, which the wake needs. ` +
      `Ask the user to click the "${appQuery}" window once, then retry.)`
    )
  }
  if (snapshot.wakeIncomplete) {
    return (
      '(the app exposed no accessibility tree yet — its interface may still be waking. ' +
      'Retry in a few seconds.)'
    )
  }
  return '(the app exposed no accessibility tree)'
}

export function buildSnapshotAppResponse(
  appQuery: string,
  snapshot: AppSnapshot,
): { content: Array<{ type: 'text'; text: string }> } {
  const hasTree = snapshot.tree.trim().length > 0
  const body = hasTree ? snapshot.tree : describeEmptyTree(appQuery, snapshot)
  // A non-empty but incomplete tree still deserves the caveat — content may be missing.
  const caveat =
    hasTree && snapshot.wakeIncomplete
      ? "\n\n(note: the app's interface may not be fully loaded — retry if something seems missing)"
      : ''
  return {
    content: [{ type: 'text', text: `Accessibility tree for "${appQuery}":\n\n${body}${caveat}` }],
  }
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
        .describe('Max accessibility-tree depth to read. Default 12 (25 for Electron apps), capped at 40.'),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Only after a timeout: retry the same call with a longer limit (default 25000, max ' +
            '120000). A big window, a heavy page or a cold start can genuinely need it. If it ' +
            'times out again at the higher limit, stop raising it and use screenshot_app instead.',
        ),
    },
    async (args: Record<string, unknown>) => {
      try {
        const app = typeof args['app'] === 'string' ? args['app'] : ''
        const maxDepth = typeof args['maxDepth'] === 'number' ? args['maxDepth'] : undefined
        const timeoutMs = typeof args['timeoutMs'] === 'number' ? args['timeoutMs'] : undefined
        const snapshot = await snapshotApp(
          app,
          {
            ...(maxDepth !== undefined ? { maxDepth } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          },
        )
        return buildSnapshotAppResponse(app, snapshot)
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

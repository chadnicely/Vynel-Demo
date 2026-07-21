import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn, McpToolContent } from './mcp-tool-fn.js'
import { screenshotApp, type AppScreenshot } from '../a11y/screenshot-adapter.js'

const TOOL_DESCRIPTION =
  "Capture a desktop app's window as a PNG screenshot — your fallback eyes when the accessibility " +
  'tree fails you. Use snapshot_app FIRST (element-addressing is faster, cheaper, and drives ' +
  'actions); reach for a screenshot when the tree came back empty, when content is canvas-drawn or ' +
  'custom-drawn (some Electron/Qt apps), or when you need visual confirmation of what the user ' +
  'actually sees. Pass `app` = the app/window name or a distinctive part of it (case-insensitive; ' +
  'match list_open_apps first). Captures WITHOUT focusing or disturbing the window; a minimized ' +
  'window cannot be captured (the error tells you to have the user restore it). It changes no app ' +
  "data. Windows only today. PRIVACY: this captures whatever is on that app's screen — only " +
  'screenshot an app the user has asked you to work with, never to browse for secrets.'

export function buildScreenshotAppResponse(screenshot: AppScreenshot): {
  content: McpToolContent[]
} {
  return {
    content: [
      {
        type: 'text',
        text: `Screenshot of "${screenshot.windowTitle}" (app: ${screenshot.appName}):`,
      },
      { type: 'image', data: screenshot.pngBase64, mimeType: 'image/png' },
    ],
  }
}

/** Construct the read-only `screenshot_app` SDK MCP tool. */
export function makeScreenshotAppTool(): unknown {
  return (tool as unknown as McpToolFn)(
    'screenshot_app',
    TOOL_DESCRIPTION,
    {
      app: z
        .string()
        .describe(
          'The app/window name to capture, or a distinctive substring of it (case-insensitive).',
        ),
    },
    async (args: Record<string, unknown>) => {
      try {
        const app = typeof args['app'] === 'string' ? args['app'] : ''
        return buildScreenshotAppResponse(await screenshotApp(app))
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    // readOnlyHint: true — capture changes no app data and, unlike the Electron
    // a11y wake, does not even move focus.
    { annotations: { readOnlyHint: true } },
  )
}

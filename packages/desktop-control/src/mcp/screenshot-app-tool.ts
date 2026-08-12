import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn, McpToolContent } from './mcp-tool-fn.js'
import { screenshotApp, type AppScreenshot } from '../a11y/screenshot-adapter.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'

const TOOL_DESCRIPTION =
  "Capture a desktop app's window as a PNG screenshot — your fallback eyes when the accessibility " +
  'tree fails you. Use snapshot_app FIRST (element-addressing is faster, cheaper, and drives ' +
  'actions); reach for a screenshot when the tree came back empty, when content is canvas-drawn or ' +
  'custom-drawn (some Electron/Qt apps), or when you need visual confirmation of what the user ' +
  'actually sees. Pass `app` = the app/window name or a distinctive part of it (case-insensitive; ' +
  'match list_open_apps first). Oversized windows are downscaled toward 1280×800 for accuracy — ' +
  'act_on_desktop coordinates in the RETURNED image frame land correctly. To inspect a detail at ' +
  'full resolution, pass `region` = {x, y, width, height} in the full window frame (a zoom; act ' +
  'coordinates still come from a FULL capture). An open window is captured WITHOUT focusing or ' +
  'disturbing it; a MINIMIZED window is restored for you first (so it does come to the screen) — ' +
  'you never need to ask the user to open it. It ' +
  "changes no app data. Windows only today. PRIVACY: this captures whatever is on that app's " +
  'screen — only screenshot an app the user has asked you to work with, never to browse for secrets.'

export function buildScreenshotAppResponse(screenshot: AppScreenshot): {
  content: McpToolContent[]
} {
  // A zoomed region is for READING detail — its pixels are not the act frame,
  // so the caption says exactly which coordinates remain actionable.
  const caption =
    screenshot.region !== null
      ? `Zoomed screenshot of "${screenshot.windowTitle}" (app: ${screenshot.appName}) — region ` +
        `${screenshot.region.width}×${screenshot.region.height}px at (${screenshot.region.x}, ${screenshot.region.y}) ` +
        `of the ${screenshot.windowWidth}×${screenshot.windowHeight}px window. For act_on_desktop, take a ` +
        'FULL screenshot and use ITS frame — do not use zoomed-image coordinates:'
      : `Screenshot of "${screenshot.windowTitle}" (app: ${screenshot.appName}), ` +
        `${screenshot.width}×${screenshot.height}px` +
        (screenshot.scale < 1
          ? ` (window ${screenshot.windowWidth}×${screenshot.windowHeight}px, downscaled for accuracy)`
          : '') +
        ` — for act_on_desktop with app="${screenshot.appName}", the top-left of THIS image is (0, 0):`
  return {
    content: [
      { type: 'text', text: caption },
      { type: 'image', data: screenshot.pngBase64, mimeType: 'image/png' },
    ],
  }
}

function parseRegion(raw: unknown): { x: number; y: number; width: number; height: number } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  const x = candidate['x']
  const y = candidate['y']
  const width = candidate['width']
  const height = candidate['height']
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null
  }
  return { x, y, width, height }
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
      region: z
        .object({
          x: z.number().min(0),
          y: z.number().min(0),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .optional()
        .describe(
          'Zoom: a window-relative rectangle to capture at full resolution (for reading detail, not for act coordinates).',
        ),
    },
    async (args: Record<string, unknown>) => {
      try {
        const app = typeof args['app'] === 'string' ? args['app'] : ''
        const region = parseRegion(args['region'])
        return buildScreenshotAppResponse(
          await screenshotApp(app, region !== null ? { region } : {}),
        )
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    // readOnlyHint: true — capture changes no app DATA. It is not perfectly
    // side-effect-free: a minimized target is restored first (which activates
    // that window), the same already-accepted class as the Electron wake's
    // focus. Vynel's carding runs off the descriptor's mutating/ask tiers, not
    // this hint, so it stays a truthful "reads, never writes" signal.
    { annotations: { readOnlyHint: true } },
  )
}

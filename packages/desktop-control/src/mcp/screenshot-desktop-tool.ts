import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn, McpToolContent } from './mcp-tool-fn.js'
import { screenshotDesktop, type DesktopScreenshot } from '../a11y/screenshot-desktop.js'

const TOOL_DESCRIPTION =
  'Capture an ENTIRE screen as a PNG — the answer to "what\'s on my screen?". One monitor per ' +
  'call: omit `monitor` for the primary, or pass an id from list_monitors for another. Use it to ' +
  'get oriented (what is open, where things sit, what the user is looking at); for reading or ' +
  'acting on ONE app, prefer snapshot_app / screenshot_app — sharper, cheaper, and their ' +
  'coordinates drive act_on_desktop directly. PRIVACY: this sees EVERYTHING on that screen, ' +
  'including apps the user never mentioned — capture it to answer what they asked, never to browse. ' +
  'Windows only.'

export function buildScreenshotDesktopResponse(screenshot: DesktopScreenshot): {
  content: McpToolContent[]
} {
  const { monitor } = screenshot
  // The math the model needs to aim from this image, stated where the image is
  // — a whole-screen point must be turned into a VIRTUAL-DESKTOP coordinate,
  // and unlike screenshot_app there is no window-relative input path to do the
  // scaling for it.
  const aiming =
    screenshot.scale < 1
      ? ` This image is downscaled ×${screenshot.scale.toFixed(3)} from the ${monitor.width}×${monitor.height}px screen. ` +
        `To click something seen here at (x, y), use act_on_desktop WITHOUT \`app\` at ` +
        `(${monitor.x} + x/${screenshot.scale.toFixed(3)}, ${monitor.y} + y/${screenshot.scale.toFixed(3)}) — ` +
        'or better, screenshot_app the target window and use its frame, which needs no math.'
      : ` To click something seen here at (x, y), use act_on_desktop WITHOUT \`app\` at ` +
        `(${monitor.x} + x, ${monitor.y} + y) — or screenshot_app the target window and use its frame.`
  const caption =
    `Screenshot of ${monitor.isPrimary ? 'the primary screen' : `screen ${monitor.id}`} ` +
    `("${monitor.name}", ${monitor.width}×${monitor.height}px at (${monitor.x}, ${monitor.y})), ` +
    `returned at ${screenshot.width}×${screenshot.height}px.` +
    aiming
  return {
    content: [
      { type: 'text', text: caption },
      { type: 'image', data: screenshot.pngBase64, mimeType: 'image/png' },
    ],
  }
}

export type ScreenshotDesktopToolDeps = {
  capture?: typeof screenshotDesktop
}

/** Construct the read-only `screenshot_desktop` SDK MCP tool. */
export function makeScreenshotDesktopTool(deps: ScreenshotDesktopToolDeps = {}): unknown {
  const capture = deps.capture ?? screenshotDesktop
  return (tool as unknown as McpToolFn)(
    'screenshot_desktop',
    TOOL_DESCRIPTION,
    {
      monitor: z
        .number()
        .int()
        .optional()
        .describe('The monitor id from list_monitors. Omit for the primary screen.'),
    },
    async (args: Record<string, unknown>) => {
      try {
        const monitorId = typeof args['monitor'] === 'number' ? args['monitor'] : undefined
        return buildScreenshotDesktopResponse(await capture(monitorId))
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

import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpToolFn } from './mcp-tool-fn.js'
import { listMonitors, type MonitorInfo } from '../a11y/monitors.js'

// Ungated like `list_open_apps` and `list_installed_apps`: knowing a screen
// exists reveals nothing about what is ON it. Seeing content still needs a
// per-app grant through snapshot_app / screenshot_app.
const TOOL_DESCRIPTION =
  'List the displays connected to this computer — id, position, size, scaling and orientation. ' +
  'READ-ONLY. Call this when the user mentions another screen, or before using ABSOLUTE ' +
  'coordinates, so you know the real layout instead of assuming one 1920x1080 screen. ' +
  'Coordinates are a single virtual desktop: a monitor left of or above the primary has ' +
  'NEGATIVE x/y, which are valid. `bounds` is the rectangle to aim in — pass it straight to ' +
  'set_window_bounds to fill a screen, or halve its width for one side. ' +
  'NEVER scale or adjust these numbers, and never scale window-relative coordinates either: ' +
  '`scaleFactor` tells you the user\'s text and buttons are enlarged, which helps you READ the ' +
  'screen — it is not a factor to multiply by. ' +
  'Windows only today; returns an empty list elsewhere.'

/** The wire shape — `bounds` is the rectangle to AIM in, stated explicitly so
 *  the model never has to combine an origin with a physical size (they are in
 *  different units on a scaled display). */
export function buildListMonitorsResponse(monitors: MonitorInfo[]): {
  content: Array<{ type: 'text'; text: string }>
} {
  const described = monitors.map((monitor) => ({
    id: monitor.id,
    name: monitor.name,
    isPrimary: monitor.isPrimary,
    // ONE rectangle, reported exactly as the OS gives it. There is deliberately
    // no second "logical" size any more: a per-monitor-DPI-aware process — the
    // frame both clicks and window moves run in — reports this machine's 125%
    // panel as -1080,-847 1080x1920, identical to this. The invented logical
    // size (864x1536) would have made "fill that screen" cover 64% of it.
    bounds: { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height },
    scaleFactor: monitor.scaleFactor,
    rotationDegrees: monitor.rotationDegrees,
    ...(monitor.scaleFactor !== 1
      ? {
          note:
            `The user has this display scaled to ${Math.round(monitor.scaleFactor * 100)}%, so text ` +
            'and buttons are physically larger than the pixel count suggests. That is context for ' +
            'reading the screen — do NOT scale coordinates by it. `bounds` is already the ' +
            'rectangle to aim in.',
        }
      : {}),
  }))
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ count: described.length, monitors: described }, null, 2),
      },
    ],
  }
}

/** Construct the read-only `list_monitors` SDK MCP tool. */
export function makeListMonitorsTool(): unknown {
  return (tool as unknown as McpToolFn)(
    'list_monitors',
    TOOL_DESCRIPTION,
    {},
    async () => {
      try {
        return buildListMonitorsResponse(listMonitors())
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

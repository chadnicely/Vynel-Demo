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
  'NEGATIVE x/y, which are valid. Aim with `bounds` — never build a rectangle from x/y plus ' +
  'physicalSize, because on a scaled display those two are in different units. ' +
  'IMPORTANT — scaling does NOT apply to window work: a window\'s screenshot and the coordinates ' +
  'you pass with `app` always agree, on every monitor, so NEVER scale or adjust window-relative ' +
  'coordinates yourself. `scaleFactor` is here to describe the display, not to correct anything. ' +
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
    // What to aim with.
    bounds: {
      x: monitor.x,
      y: monitor.y,
      width: monitor.logicalWidth,
      height: monitor.logicalHeight,
    },
    // The panel's own pixel count — descriptive only. Deliberately NOT framed
    // as "what a screenshot measures": the only screenshots this package takes
    // are of a WINDOW, and a window's capture matches its bounds on every
    // monitor. Saying otherwise invites the model to invent a correction and
    // click in the wrong place — measured 2026-08-11, see the retraction in
    // docs/module-notes/desktop-autopilot.md.
    physicalSize: { width: monitor.physicalWidth, height: monitor.physicalHeight },
    scaleFactor: monitor.scaleFactor,
    rotationDegrees: monitor.rotationDegrees,
    ...(monitor.scaleFactor !== 1
      ? {
          note:
            `This display is scaled ${Math.round(monitor.scaleFactor * 100)}%. That affects THIS ` +
            'rectangle only — use bounds, not physicalSize, for absolute coordinates. It does not ' +
            'affect window-relative coordinates, which need no adjustment on any monitor.',
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

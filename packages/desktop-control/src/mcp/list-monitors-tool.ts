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
  'NEGATIVE x/y, which are valid. Use `logicalWidth`/`logicalHeight` for aiming — on a scaled ' +
  'display those differ from the physical pixel size a screenshot measures. ' +
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
    // What a capture of this screen would measure.
    physicalSize: { width: monitor.physicalWidth, height: monitor.physicalHeight },
    scaleFactor: monitor.scaleFactor,
    rotationDegrees: monitor.rotationDegrees,
    ...(monitor.scaleFactor !== 1
      ? {
          note:
            `This display is scaled ${Math.round(monitor.scaleFactor * 100)}%. A screenshot of it ` +
            'measures physicalSize, but coordinates you act on live in bounds.',
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

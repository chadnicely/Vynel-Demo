// Move/resize a window — "put Chrome on my other screen", "make Slack fill the
// left half".
//
// A `click`-class change (it rearranges the screen but types nothing), and
// PLAN-GATED by construction like every other act tool.
//
// ⚠ THE COORDINATE FRAME, measured 2026-08-11 — this is the one thing to get
// right. `SetWindowPos` takes VIRTUAL-DESKTOP coordinates and honours them
// exactly, including negative origins and scaled displays: asked
// (-1000,-800,640,480) on a 125% portrait panel, got precisely that back. Those
// are the same coordinates `list_monitors` reports as `bounds`, which is why the
// tool tells the model to size from there.
//
// They are NOT the numbers `screenshot_app` works in. node-screenshots reports a
// window's *visible frame* — inset by the invisible resize border, and divided
// by the scale factor on a scaled monitor (that same window read back as
// -1010,-785,499,353). Feeding those into this tool would shrink and drift the
// window a little more on every round trip, so the description says plainly
// where the numbers must come from.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import { findWindowedPidByName } from '../a11y/windowed-process.js'
import { resolveAppIdentity } from '../a11y/window-identity.js'
import { rejectUnusableBounds, setWindowBounds } from '../a11y/window-bounds.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'
import type { DesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { makePlanGatedAuthorizer, planRequiredError } from '../plan/plan-gated-authorization.js'

const TOOL_DESCRIPTION =
  'Move and resize an app window — put it on another screen, or lay it out beside something else. ' +
  'Requires a plan (propose_desktop_plan) naming the app. Take x/y/width/height from ' +
  "list_monitors' `bounds`: to fill a screen use that rectangle, to use half of it halve the " +
  'width. A monitor left of or above the main one has NEGATIVE x/y, which are correct. ' +
  'IMPORTANT: do NOT pass the size or position from screenshot_app — that is a different frame ' +
  '(the visible window area, scaled on a scaled display), and reusing it shrinks the window a ' +
  'little each time. Prefer this over DRAGGING a title bar: dragging across screens is slow, can ' +
  'drop half-way, and failure looks exactly like nothing happening. It reports where the window ' +
  'actually ended up — an app may clamp a size it will not accept. Windows only.'

export type SetWindowBoundsToolDeps = {
  findPid?: (query: string) => Promise<number | null>
  appNameByPid?: (pid: number) => string | null
  apply?: typeof setWindowBounds
}

/** Construct the `set_window_bounds` SDK MCP tool (mutating — destructiveHint). */
export function makeSetWindowBoundsTool(
  envelope: DesktopPlanEnvelope,
  authorize?: DesktopAccessAuthorizer,
  deps: SetWindowBoundsToolDeps = {},
): unknown {
  const effectiveAuthorize = makePlanGatedAuthorizer(envelope, authorize)
  const findPid = deps.findPid ?? findWindowedPidByName
  const apply = deps.apply ?? setWindowBounds
  const appNameByPid = deps.appNameByPid
  return (tool as unknown as McpToolFn)(
    'set_window_bounds',
    TOOL_DESCRIPTION,
    {
      app: z
        .string()
        .min(1)
        .describe('The app/window to move (name or a distinctive substring; match list_open_apps).'),
      // Deliberately NOT `.min(0)`: a display left of or above the primary has
      // negative coordinates, and rejecting those would make the second monitor
      // unreachable — the trap Guide §15.4 calls out.
      x: z.number().int().describe('Left edge, in list_monitors coordinates. May be negative.'),
      y: z.number().int().describe('Top edge, in list_monitors coordinates. May be negative.'),
      width: z.number().int().positive().describe('Window width.'),
      height: z.number().int().positive().describe('Window height.'),
    },
    async (args: Record<string, unknown>) => {
      const planRefusal = planRequiredError(envelope)
      if (planRefusal !== null) {
        return { content: [{ type: 'text', text: planRefusal }], isError: true }
      }
      const query = typeof args['app'] === 'string' ? args['app'].trim() : ''
      const bounds = {
        x: Number(args['x']),
        y: Number(args['y']),
        width: Number(args['width']),
        height: Number(args['height']),
      }
      if (query.length === 0) {
        return { content: [{ type: 'text', text: 'An "app" is required.' }], isError: true }
      }
      // Validated BEFORE resolving anything — a nonsense rectangle should cost
      // no PowerShell spawn and touch no window.
      const unusable = rejectUnusableBounds(bounds)
      if (unusable !== null) {
        return { content: [{ type: 'text', text: unusable }], isError: true }
      }
      try {
        const pid = await findPid(query)
        if (pid === null) {
          return {
            content: [
              {
                type: 'text',
                text: `No open window matches "${query}". Call list_open_apps to see what's open.`,
              },
            ],
            isError: true,
          }
        }
        // Canonical grant identity, then the click tier against IT — never the
        // fuzzy query — before the window moves.
        const appName =
          appNameByPid !== undefined
            ? resolveAppIdentity(pid, query, appNameByPid)
            : resolveAppIdentity(pid, query)
        effectiveAuthorize(appName, 'click')

        const outcome = await apply(pid, bounds)
        if (!outcome.ok) {
          return {
            content: [
              {
                type: 'text',
                text:
                  outcome.reason === 'no-window'
                    ? `"${appName}" has no reachable main window to move (it may be minimized to ` +
                      'the system tray). Use launch_app to bring it back first.'
                    : `Could not move "${appName}" — the window did not accept the new position.`,
              },
            ],
            isError: true,
          }
        }
        const { applied } = outcome
        // Report where it ACTUALLY landed: an app may clamp a minimum size or
        // snap a position, and echoing the request would have the model aim its
        // next click at a rectangle that does not exist.
        const exact =
          applied.x === bounds.x &&
          applied.y === bounds.y &&
          applied.width === bounds.width &&
          applied.height === bounds.height
        return {
          content: [
            {
              type: 'text',
              text:
                `"${appName}" is now at ${applied.x},${applied.y} ` +
                `(${applied.width}x${applied.height})` +
                (exact
                  ? '.'
                  : ` — the app adjusted your ${bounds.width}x${bounds.height} request; use these ` +
                    'numbers, not the ones you asked for.'),
            },
          ],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { destructiveHint: true } },
  )
}

// Coordinate desktop input — click / type / press / scroll / drag at a pixel,
// via nut.js. The sibling of `a11y/xa11y-adapter.ts`'s `actOnApp`: that acts on
// an accessibility ELEMENT (selector), this acts at a SCREEN POSITION — the path
// Claude uses when it only has a screenshot (no accessibility tree). Every op is
// bounded by the shared `withTimeout` backstop so an input call can never hang
// the brain.
//
// Window-relative coordinates: when `app` is given, x/y are relative to that
// window's top-left (matching what `screenshot_app` showed), translated to
// absolute screen coords via the window origin — so Claude clicks where it SEES
// in the screenshot without doing offset math. Without `app`, x/y are absolute.

import { loadNutInput } from './nut-input-loader.js'
import { parseKeyCombo } from './key-combo.js'
import { performSteppedDrag } from './human-drag.js'
import { withTimeout } from '../a11y/xa11y-loader.js'
import {
  authorizeFocusedTarget,
  authorizeMouseTarget,
  DEFAULT_INPUT_PROBES,
  type DesktopInputProbes,
} from './input-authorization.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'

export type { DesktopInputProbes, ResolvedTargetFrame, FrameBounds } from './input-authorization.js'

export const DESKTOP_INPUT_ACTIONS = [
  'click',
  'type',
  'press',
  'scroll',
  'drag',
  'move',
] as const
export type DesktopInputAction = (typeof DESKTOP_INPUT_ACTIONS)[number]
export type MouseButton = 'left' | 'right' | 'middle'
export type ScrollDirection = 'up' | 'down' | 'left' | 'right'

export interface ActOnDesktopParams {
  action: DesktopInputAction
  x?: number
  y?: number
  toX?: number
  toY?: number
  text?: string
  keys?: string
  button?: MouseButton
  double?: boolean
  direction?: ScrollDirection
  amount?: number
  /** When set, x/y/toX/toY are relative to this window's top-left (the screenshot frame). */
  app?: string
}

export interface ActOnDesktopResult {
  action: DesktopInputAction
  /** Human summary for the tool response + overlay narration. */
  detail: string
}

const INPUT_TIMEOUT_MS = 15000
const DEFAULT_SCROLL_AMOUNT = 3

// A screen-coordinate translation frame: absolute when no app, window-origin
// offset when an app was named. `scale` is the screenshot downscale factor
// (`computeCaptureScale` from the same window bounds — capture-time and
// click-time agree unless the window was resized in between): the model's
// coordinates live in the SCALED image, so they divide back up before the
// origin offset applies. Pure + exported for tests.
export interface CoordinateFrame {
  offsetX: number
  offsetY: number
  /** Screenshot downscale factor for window-relative coords (default 1). */
  scale?: number
}

export function translatePoint(
  frame: CoordinateFrame,
  x: number,
  y: number,
): { x: number; y: number } {
  const scale = frame.scale ?? 1
  return {
    x: Math.round(x / scale + frame.offsetX),
    y: Math.round(y / scale + frame.offsetY),
  }
}

function requireNumber(value: number | undefined, name: string, action: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`The "${action}" action requires a numeric "${name}".`)
  }
  return value
}

function mapButton(button: MouseButton | undefined, buttons: { LEFT: number; MIDDLE: number; RIGHT: number }): number {
  switch (button) {
    case 'right':
      return buttons.RIGHT
    case 'middle':
      return buttons.MIDDLE
    default:
      return buttons.LEFT
  }
}

// The validated, native-free shape of one action — required fields already
// resolved (so param validation throws BEFORE the engine or node-screenshots is
// touched: the guards stay binary-free, and a malformed action never degrades
// into an arbitrary input).
type ActionPlan =
  | { action: 'click'; x: number; y: number }
  | { action: 'type'; text: string }
  | { action: 'press'; keys: string }
  | { action: 'scroll'; x: number; y: number }
  | { action: 'drag'; x: number; y: number; toX: number; toY: number }
  | { action: 'move'; x: number; y: number }

export function planDesktopAction(params: ActOnDesktopParams): ActionPlan {
  switch (params.action) {
    case 'click':
      return {
        action: 'click',
        x: requireNumber(params.x, 'x', 'click'),
        y: requireNumber(params.y, 'y', 'click'),
      }
    case 'type':
      if (typeof params.text !== 'string' || params.text.length === 0) {
        throw new Error('The "type" action requires a non-empty "text".')
      }
      return { action: 'type', text: params.text }
    case 'press':
      if (typeof params.keys !== 'string' || params.keys.trim().length === 0) {
        throw new Error('The "press" action requires "keys" (e.g. "enter" or "ctrl+c").')
      }
      return { action: 'press', keys: params.keys }
    case 'scroll':
      return {
        action: 'scroll',
        x: requireNumber(params.x, 'x', 'scroll'),
        y: requireNumber(params.y, 'y', 'scroll'),
      }
    case 'drag':
      return {
        action: 'drag',
        x: requireNumber(params.x, 'x', 'drag'),
        y: requireNumber(params.y, 'y', 'drag'),
        toX: requireNumber(params.toX, 'toX', 'drag'),
        toY: requireNumber(params.toY, 'toY', 'drag'),
      }
    case 'move':
      return {
        action: 'move',
        x: requireNumber(params.x, 'x', 'move'),
        y: requireNumber(params.y, 'y', 'move'),
      }
    default: {
      // Exhaustiveness guard — a new action MUST add a case above.
      const unhandled: never = params.action
      throw new Error(`Unsupported desktop input action: ${String(unhandled)}`)
    }
  }
}

/**
 * Perform a coordinate input action. Validates params FIRST (fail-closed, no
 * native load), then loads the input engine + resolves the coordinate frame,
 * then executes — every op bounded by `withTimeout`.
 */
export async function actOnDesktop(
  params: ActOnDesktopParams,
  authorize?: DesktopAccessAuthorizer,
  probes: DesktopInputProbes = DEFAULT_INPUT_PROBES,
): Promise<ActOnDesktopResult> {
  const plan = planDesktopAction(params)
  const where = params.app !== undefined ? ` in "${params.app}"` : ''
  // Ordering per case: resolve the target → AUTHORIZE → only then load the
  // input engine and act. A denied or unidentifiable target must never load
  // nut.js, let alone move the mouse. The coordinate frame is resolved ONLY
  // inside the coordinate cases — type/press don't use it, and resolving
  // throws when `app` can't be found, so a keystroke into the focused window
  // must never fail on a stale `app`.

  switch (plan.action) {
    case 'click': {
      const resolved = probes.resolveTargetFrame(params.app)
      const point = translatePoint(resolved.frame, plan.x, plan.y)
      authorizeMouseTarget(authorize, probes, resolved, point, 'click')
      const { mouse, Point, Button } = loadNutInput()
      const button = mapButton(params.button, Button)
      await withTimeout(mouse.setPosition(new Point(point.x, point.y)), INPUT_TIMEOUT_MS, 'move')
      await withTimeout(
        params.double === true ? mouse.doubleClick(button) : mouse.click(button),
        INPUT_TIMEOUT_MS,
        'click',
      )
      const kind = params.double === true ? 'double-click' : `${params.button ?? 'left'} click`
      return { action: 'click', detail: `${kind} at (${point.x}, ${point.y})${where}` }
    }
    case 'type': {
      authorizeFocusedTarget(authorize, probes, 'type')
      const { keyboard } = loadNutInput()
      await withTimeout(keyboard.type(plan.text), INPUT_TIMEOUT_MS, 'type')
      return { action: 'type', detail: `typed "${plan.text}"${where}` }
    }
    case 'press': {
      authorizeFocusedTarget(authorize, probes, 'press')
      const { keyboard, Key } = loadNutInput()
      const keyValues = parseKeyCombo(plan.keys, Key)
      await withTimeout(keyboard.pressKey(...keyValues), INPUT_TIMEOUT_MS, 'press')
      // Release in reverse so a chord unwinds cleanly (modifier released last).
      await withTimeout(keyboard.releaseKey(...[...keyValues].reverse()), INPUT_TIMEOUT_MS, 'press')
      return { action: 'press', detail: `pressed ${plan.keys}` }
    }
    case 'scroll': {
      const resolved = probes.resolveTargetFrame(params.app)
      const point = translatePoint(resolved.frame, plan.x, plan.y)
      authorizeMouseTarget(authorize, probes, resolved, point, 'click')
      const { mouse, Point } = loadNutInput()
      const amount = params.amount ?? DEFAULT_SCROLL_AMOUNT
      const direction = params.direction ?? 'down'
      await withTimeout(mouse.setPosition(new Point(point.x, point.y)), INPUT_TIMEOUT_MS, 'move')
      const scroll =
        direction === 'up'
          ? mouse.scrollUp(amount)
          : direction === 'left'
            ? mouse.scrollLeft(amount)
            : direction === 'right'
              ? mouse.scrollRight(amount)
              : mouse.scrollDown(amount)
      await withTimeout(scroll, INPUT_TIMEOUT_MS, 'scroll')
      return { action: 'scroll', detail: `scrolled ${direction} at (${point.x}, ${point.y})${where}` }
    }
    case 'drag': {
      const resolved = probes.resolveTargetFrame(params.app)
      const from = translatePoint(resolved.frame, plan.x, plan.y)
      const to = translatePoint(resolved.frame, plan.toX, plan.toY)
      // A drag has TWO ends — authorize both (an absolute drag can drop onto a
      // different app than it grabbed from).
      authorizeMouseTarget(authorize, probes, resolved, from, 'click')
      authorizeMouseTarget(authorize, probes, resolved, to, 'click')
      // Press → threshold nudge → stepped travel → dwell → guaranteed release,
      // rather than nut's one-jump `drag()`. The whole gesture lives in
      // `human-drag.ts`, next to the path it walks — see there for why a jump
      // moves a slider but never completes a drop.
      await performSteppedDrag(from, to)
      return {
        action: 'drag',
        detail: `dragged (${from.x}, ${from.y}) → (${to.x}, ${to.y})${where}`,
      }
    }
    case 'move': {
      const resolved = probes.resolveTargetFrame(params.app)
      const point = translatePoint(resolved.frame, plan.x, plan.y)
      // Moving the pointer is `click`-tier: it is how a hover menu opens or a
      // tooltip appears, so it changes what is on screen.
      authorizeMouseTarget(authorize, probes, resolved, point, 'click')
      const { mouse, Point } = loadNutInput()
      await withTimeout(mouse.setPosition(new Point(point.x, point.y)), INPUT_TIMEOUT_MS, 'move')
      return { action: 'move', detail: `moved to (${point.x}, ${point.y})${where}` }
    }
  }
}

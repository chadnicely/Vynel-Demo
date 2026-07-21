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
import { findAppWindowBounds } from '../a11y/screenshot-adapter.js'
import { withTimeout } from '../a11y/xa11y-loader.js'

export const DESKTOP_INPUT_ACTIONS = ['click', 'type', 'press', 'scroll', 'drag'] as const
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
// offset when an app was named. Pure + exported for tests.
export interface CoordinateFrame {
  offsetX: number
  offsetY: number
}

export function translatePoint(
  frame: CoordinateFrame,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: Math.round(x + frame.offsetX), y: Math.round(y + frame.offsetY) }
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

// Resolve the coordinate frame — the one place that reaches node-screenshots for
// the window origin. Fails closed with an actionable error when the named app
// isn't open (so a click never lands at a stale/absolute position by surprise).
//
// DPI PRECONDITION: the window origin here is in node-screenshots' PHYSICAL
// pixels, and nut.js `setPosition` expects the OS coordinate space. These
// coincide only at 100% display scaling; on a scaled display (125%/150%) the
// captured image, the reported window size, and the cursor can diverge and a
// window-relative click lands off-target. Verified coherent at 100%; a scale
// factor is the fix if a scaled display shows drift (see `translatePoint`).
function resolveFrame(app: string | undefined): CoordinateFrame {
  if (app === undefined || app.trim().length === 0) {
    return { offsetX: 0, offsetY: 0 }
  }
  const bounds = findAppWindowBounds(app)
  if (bounds === null) {
    throw new Error(
      `Could not resolve the "${app}" window to translate coordinates. Call list_open_apps, or omit ` +
        '"app" to use absolute screen coordinates.',
    )
  }
  return { offsetX: bounds.x, offsetY: bounds.y }
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
export async function actOnDesktop(params: ActOnDesktopParams): Promise<ActOnDesktopResult> {
  const plan = planDesktopAction(params)
  const { mouse, keyboard, Point, Button, Key } = loadNutInput()
  const where = params.app !== undefined ? ` in "${params.app}"` : ''
  // The coordinate frame is resolved ONLY inside the coordinate cases below —
  // type/press don't use it, and resolving throws when `app` can't be found, so
  // a keystroke into the focused window must never fail on a stale `app`.

  switch (plan.action) {
    case 'click': {
      const point = translatePoint(resolveFrame(params.app), plan.x, plan.y)
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
      await withTimeout(keyboard.type(plan.text), INPUT_TIMEOUT_MS, 'type')
      return { action: 'type', detail: `typed "${plan.text}"${where}` }
    }
    case 'press': {
      const keyValues = parseKeyCombo(plan.keys, Key)
      await withTimeout(keyboard.pressKey(...keyValues), INPUT_TIMEOUT_MS, 'press')
      // Release in reverse so a chord unwinds cleanly (modifier released last).
      await withTimeout(keyboard.releaseKey(...[...keyValues].reverse()), INPUT_TIMEOUT_MS, 'press')
      return { action: 'press', detail: `pressed ${plan.keys}` }
    }
    case 'scroll': {
      const point = translatePoint(resolveFrame(params.app), plan.x, plan.y)
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
      const frame = resolveFrame(params.app)
      const from = translatePoint(frame, plan.x, plan.y)
      const to = translatePoint(frame, plan.toX, plan.toY)
      await withTimeout(
        mouse.drag([new Point(from.x, from.y), new Point(to.x, to.y)]),
        INPUT_TIMEOUT_MS,
        'drag',
      )
      return {
        action: 'drag',
        detail: `dragged (${from.x}, ${from.y}) → (${to.x}, ${to.y})${where}`,
      }
    }
  }
}

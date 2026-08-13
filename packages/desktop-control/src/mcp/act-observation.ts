// The PIPELINE half of acting (Kafi, 2026-08-13): an act tool that can also
// SHOW its result saves the model a full round-trip per step — act, then
// screenshot_app, then think, becomes act-and-see, then think. One home,
// because three tools append the same observation and a fourth added later
// must not re-invent the capture-never-fails rule below.
//
// OPT-IN per call (Kafi's pick over always-on): the model asks to see only
// when its next step depends on what changed, so a blind batch of keystrokes
// never pays image tokens for a picture nobody reads.

import { screenshotApp } from '../a11y/screenshot-adapter.js'
import { screenshotDesktop } from '../a11y/screenshot-desktop.js'
import type { McpToolContent } from './mcp-tool-fn.js'

/** Enough for a UI to repaint after a click; not enough for a page load. */
export const OBSERVE_SETTLE_DEFAULT_MS = 400
/** The ceiling keeps a "settle" from becoming an unbounded sleep inside a
 *  tool call — a real load with an unknown duration is wait_for's job. */
export const OBSERVE_SETTLE_MAX_MS = 5000

export type ObserveRequest = {
  observe: boolean
  settleMs: number
}

/** Read the observe args off the SDK's loose bag, clamping the settle. */
export function parseObserveRequest(args: Record<string, unknown>): ObserveRequest {
  const requested = typeof args['observeSettleMs'] === 'number' ? args['observeSettleMs'] : undefined
  const settleMs =
    requested === undefined
      ? OBSERVE_SETTLE_DEFAULT_MS
      : Math.min(OBSERVE_SETTLE_MAX_MS, Math.max(0, Math.floor(requested)))
  return { observe: args['observe'] === true, settleMs }
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export type CaptureActObservationDeps = {
  captureApp?: typeof screenshotApp
  captureScreen?: typeof screenshotDesktop
  sleep?: (ms: number) => Promise<void>
}

/**
 * Capture what the screen looks like AFTER an act: the named window when the
 * call had one (its frame is directly actionable), else the primary screen
 * (absolute-coordinate work has no window frame).
 *
 * NEVER throws — the act already happened, and failing the tool call now would
 * tell the model the act failed when it did not (the recorder's rule). A
 * failed capture comes back as a note instead of an image.
 */
export async function captureActObservation(
  app: string | undefined,
  settleMs: number,
  deps: CaptureActObservationDeps = {},
): Promise<McpToolContent[]> {
  const captureApp = deps.captureApp ?? screenshotApp
  const captureScreen = deps.captureScreen ?? screenshotDesktop
  const sleep = deps.sleep ?? realSleep
  try {
    if (settleMs > 0) await sleep(settleMs)
    if (app !== undefined) {
      const shot = await captureApp(app)
      return [
        {
          type: 'text',
          text:
            `Observed after acting — "${shot.windowTitle}" (app: ${shot.appName}), ` +
            `${shot.width}×${shot.height}px. Coordinates in THIS image are the act frame for ` +
            `app="${shot.appName}" (top-left = 0,0).` +
            (shot.restored ? ' NOTE: the window was minimized and has been restored to capture it.' : ''),
        },
        { type: 'image', data: shot.pngBase64, mimeType: 'image/png' },
      ]
    }
    const screen = await captureScreen()
    // The aiming math rides the caption exactly as screenshot_desktop's does —
    // app-less coordinate work is this branch's audience, and raw image coords
    // fed back into an absolute click would miss by 1/scale.
    const aiming =
      screen.scale < 1
        ? ` This image is downscaled ×${screen.scale.toFixed(3)}: to click something seen here at ` +
          `(x, y), use (${screen.monitor.x} + x/${screen.scale.toFixed(3)}, ${screen.monitor.y} + ` +
          `y/${screen.scale.toFixed(3)}) — or screenshot_app the target window and use its frame.`
        : ` To click something seen here at (x, y), use (${screen.monitor.x} + x, ${screen.monitor.y} + y).`
    return [
      {
        type: 'text',
        text:
          `Observed after acting — the primary screen (${screen.width}×${screen.height}px).` + aiming,
      },
      { type: 'image', data: screen.pngBase64, mimeType: 'image/png' },
    ]
  } catch (err) {
    return [
      {
        type: 'text',
        text:
          `The act ran, but the follow-up observation failed: ${err instanceof Error ? err.message : String(err)} ` +
          'Use snapshot_app / screenshot_app to see the current state.',
      },
    ]
  }
}

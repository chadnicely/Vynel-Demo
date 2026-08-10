// Wait for the foreground window to stop changing — the settle that BATCHING
// removed and has to put back.
//
// nut.js resolves a click when the synthetic input is SENT; Windows activates
// the clicked window only once its thread processes the message. Between
// separate tool calls the model round-trip was that settle, so the next
// action's focus probe always read the post-click world. Inside one batch
// ([click a field, type into it]) the probe can fire in the tick after the
// click and read the PREVIOUS foreground — which either denies a legitimate
// action or, worse, authorizes app A while the keystrokes land in app B.
//
// The same activate-then-verify shape the wake path already uses
// (`a11y/window-focus.ts`, `a11y/electron-wake.ts`): poll until two
// consecutive reads agree, bounded so a genuinely churning desktop can never
// hang the turn. Timing out is NOT an error — the caller's own authorization
// still runs and still fails closed; settling just makes it read the truth.

import { DEFAULT_INPUT_PROBES, type DesktopInputProbes } from './input-authorization.js'

const SETTLE_TIMEOUT_MS = 400
const SETTLE_INTERVAL_MS = 25

export type ForegroundSettleOptions = {
  timeoutMs?: number
  intervalMs?: number
  /** Injectable for tests — production sleeps for real. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export async function waitForForegroundSettle(
  probes: DesktopInputProbes = DEFAULT_INPUT_PROBES,
  options: ForegroundSettleOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? SETTLE_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? SETTLE_INTERVAL_MS
  const sleep = options.sleep ?? realSleep
  const now = options.now ?? Date.now
  const deadline = now() + timeoutMs

  let previous = probes.focusedWindowAppName()
  while (now() < deadline) {
    await sleep(intervalMs)
    const current = probes.focusedWindowAppName()
    if (current === previous) return
    previous = current
  }
}

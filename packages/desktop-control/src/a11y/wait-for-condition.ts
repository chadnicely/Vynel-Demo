// Wait until the screen says something changed.
//
// WHY this exists. Desktop work is full of waiting — a page loads, a dialog
// opens, a spinner clears, an upload finishes. Without a primitive for it the
// model's only option is to screenshot, look, screenshot again: a full model
// round-trip per poll, each one seconds of latency and a fresh image in
// context, and it still has to guess how long to keep trying. `launch_app`
// already waits for a window and the coordinate path already waits for the
// foreground to settle — both proved the shape works; neither was reachable by
// the model.
//
// It is READ-ONLY. It changes nothing and only observes, so it needs the same
// `read` tier a snapshot does — and it is bounded twice over (a per-attempt
// timeout inside the probe, and a hard deadline here), because a wait that can
// hang is worse than no wait at all.
//
// The condition is checked IMMEDIATELY first, before any sleeping: the thing
// being waited for has often already happened by the time the model asks, and
// sleeping first would add latency to the common case.

export const WAIT_CONDITIONS = [
  'text_appears',
  'text_disappears',
  'app_appears',
  'app_closes',
] as const
export type WaitConditionKind = (typeof WAIT_CONDITIONS)[number]

export function isWaitCondition(value: unknown): value is WaitConditionKind {
  return typeof value === 'string' && (WAIT_CONDITIONS as readonly string[]).includes(value)
}

/** Whether a condition is about the app's CONTENT (needs to read its tree) or
 *  merely about the app EXISTING (needs only the open-app list). */
export function conditionReadsContent(kind: WaitConditionKind): boolean {
  return kind === 'text_appears' || kind === 'text_disappears'
}

export const DEFAULT_WAIT_TIMEOUT_MS = 15_000
/** The ceiling a caller may ask for. A model that could wait indefinitely would
 *  eventually park a turn on something that is never going to happen. */
export const MAX_WAIT_TIMEOUT_MS = 60_000
export const WAIT_POLL_INTERVAL_MS = 750

/** Clamp a requested timeout into the allowed band. Pure. */
export function clampWaitTimeout(requestedMs: number | undefined): number {
  if (requestedMs === undefined || !Number.isFinite(requestedMs) || requestedMs <= 0) {
    return DEFAULT_WAIT_TIMEOUT_MS
  }
  return Math.min(Math.floor(requestedMs), MAX_WAIT_TIMEOUT_MS)
}

export type WaitOutcome = {
  met: boolean
  /** How long we actually waited, so the model can report honestly. */
  elapsedMs: number
  /** Attempts made — 1 means it was already true when asked. */
  attempts: number
  /** Set when an attempt threw (app closed mid-wait, tree unreadable). The wait
   *  keeps going: a transient read failure is not the same as the condition
   *  being false, and `app_closes` is literally waiting for reads to fail. */
  lastError?: string
}

export type WaitProbes = {
  /** The app's accessibility tree as text, or null when the app isn't open. */
  readTree: (app: string) => Promise<string | null>
  /** Whether an app with this name is currently open. */
  isAppOpen: (app: string) => Promise<boolean>
}

export type WaitClock = {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

/** Evaluate a condition once. Pure given its inputs — the polling above it owns
 *  all the timing. */
export function conditionMet(
  kind: WaitConditionKind,
  observation: { tree: string | null; isOpen: boolean },
  text: string,
): boolean {
  switch (kind) {
    case 'text_appears':
      return observation.tree !== null && observation.tree.toLowerCase().includes(text.toLowerCase())
    case 'text_disappears':
      // An app that has CLOSED no longer shows the text, which counts: the
      // caller asked for the text to be gone, and it is.
      return observation.tree === null || !observation.tree.toLowerCase().includes(text.toLowerCase())
    case 'app_appears':
      return observation.isOpen
    case 'app_closes':
      return !observation.isOpen
  }
}

/**
 * Poll until the condition holds or the deadline passes.
 *
 * Never throws for a failed observation — a probe that errors is reported and
 * retried, because "couldn't read the app just now" and "the condition is
 * false" are different things, and one of the conditions (`app_closes`) is
 * satisfied precisely by the app becoming unreadable.
 */
export async function waitForCondition(
  input: { kind: WaitConditionKind; app: string; text?: string; timeoutMs?: number },
  probes: WaitProbes,
  clock: WaitClock,
): Promise<WaitOutcome> {
  const budgetMs = clampWaitTimeout(input.timeoutMs)
  const text = input.text ?? ''
  const startedAt = clock.now()
  let attempts = 0
  let lastError: string | undefined

  for (;;) {
    attempts += 1
    let observation: { tree: string | null; isOpen: boolean } = { tree: null, isOpen: false }
    try {
      observation = conditionReadsContent(input.kind)
        ? { tree: await probes.readTree(input.app), isOpen: true }
        : { tree: null, isOpen: await probes.isAppOpen(input.app) }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      // Leave `observation` at its "nothing readable" default and let the
      // condition decide — that is what makes app_closes work.
    }

    if (conditionMet(input.kind, observation, text)) {
      return {
        met: true,
        elapsedMs: clock.now() - startedAt,
        attempts,
        ...(lastError !== undefined ? { lastError } : {}),
      }
    }

    // Check the deadline AFTER evaluating, so the condition always gets one
    // look even at a zero budget.
    if (clock.now() - startedAt >= budgetMs) {
      return {
        met: false,
        elapsedMs: clock.now() - startedAt,
        attempts,
        ...(lastError !== undefined ? { lastError } : {}),
      }
    }
    await clock.sleep(WAIT_POLL_INTERVAL_MS)
  }
}

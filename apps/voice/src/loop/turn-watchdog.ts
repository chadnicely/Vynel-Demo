// The daemon's per-turn WATCHDOG (session-hardening arc, Kafi 2026-08-19).
//
// A server turn can park far longer than a person will stand in front of a
// microphone: a lock queue, a slow model, a tool that takes minutes. The daemon
// used to sit `busy` for exactly as long as that took — mic closed, wake word
// unheard, recoverable only by a restart. This bounds the daemon's OWN wait,
// never the server's: when it fires the driver says "still working", hands the
// room back and stops reading the stream. The turn keeps running server-side
// and its answer still arrives, through the `speak` door rather than the
// abandoned SSE read.

export interface TurnWatchdog {
  /** Aborted when the watchdog fires — the brain client stops reading. */
  readonly signal: AbortSignal
  /** True once it fired: the turn no longer owns the driver's state. */
  readonly expired: boolean
  /** Resolves when it fires. Never rejects; stays pending if it never fires. */
  readonly whenExpired: Promise<void>
  /** The turn ended on its own — cancel the timer. */
  disarm(): void
}

/** Arm a watchdog for ONE turn. `timeoutMs <= 0` disables it (never fires) so a
 *  test — or an operator who wants the old unbounded wait — can turn it off. */
export function armTurnWatchdog(timeoutMs: number): TurnWatchdog {
  const controller = new AbortController()
  let expired = false
  let fire: () => void = () => {}
  const whenExpired = new Promise<void>((resolve) => {
    fire = resolve
  })

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          expired = true
          controller.abort(new Error('the voice turn watchdog fired'))
          fire()
        }, timeoutMs)
      : null
  // A pending watchdog must never be the reason the process stays alive — the
  // daemon exits on its signals, not on a five-minute timer.
  timer?.unref?.()

  return {
    signal: controller.signal,
    get expired() {
      return expired
    },
    whenExpired,
    disarm() {
      if (timer !== null) clearTimeout(timer)
    },
  }
}

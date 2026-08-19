// The daemon's per-turn WATCHDOG (session-hardening arc, Kafi 2026-08-19).
//
// A server turn can park far longer than a person will stand in front of a
// microphone: a lock queue, a slow model, a tool that takes minutes. This bounds
// the daemon's OWN silent wait, never the server's: when it fires the driver
// says "still working" and hands the room back, while the turn keeps streaming
// in the background — its answer is still spoken when it lands (voice-realtime:
// the thread's text is its voice, so abandoning the read would lose it). The
// wake line `touch`es it on every text delta, so it measures silence, not
// turn length: a turn that is answering never trips it mid-sentence.

export interface TurnWatchdog {
  /** True once it fired: the turn no longer owns the driver's state. */
  readonly expired: boolean
  /** Resolves when it fires. Never rejects; stays pending if it never fires. */
  readonly whenExpired: Promise<void>
  /** The turn showed signs of life — restart the silence clock. */
  touch(): void
  /** The turn ended on its own — cancel the timer. */
  disarm(): void
}

/** Arm a watchdog for ONE turn. `timeoutMs <= 0` disables it (never fires) so a
 *  test — or an operator who wants the old unbounded wait — can turn it off. */
export function armTurnWatchdog(timeoutMs: number): TurnWatchdog {
  let expired = false
  let fire: () => void = () => {}
  const whenExpired = new Promise<void>((resolve) => {
    fire = resolve
  })

  let timer: ReturnType<typeof setTimeout> | null = null
  const arm = (): void => {
    if (timeoutMs <= 0) return
    timer = setTimeout(() => {
      timer = null
      expired = true
      fire()
    }, timeoutMs)
    // A pending watchdog must never be the reason the process stays alive — the
    // daemon exits on its signals, not on a five-minute timer.
    timer.unref?.()
  }
  const disarm = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  arm()

  return {
    get expired() {
      return expired
    },
    whenExpired,
    touch() {
      if (expired) return
      disarm()
      arm()
    },
    disarm,
  }
}

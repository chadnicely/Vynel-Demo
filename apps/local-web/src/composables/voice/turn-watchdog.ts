// The per-turn silence bound of the browser voice leg (round-2 R2-G): armed
// when a turn starts, it fires ONCE if nothing disarmed it within the window —
// the turn's first spoken sentence, a barge-in, or the turn's end. What it
// does on firing is the session's business (the honesty line); this is only
// the clock, kept apart so the session reads as the conversation it drives.

export interface TurnWatchdog {
  /** Start the window; a no-op while it is already running. */
  arm(): void;
  /** Cancel the window (the turn spoke, was cut, or ended) — a no-op otherwise. */
  disarm(): void;
}

export function createTurnWatchdog(options: {
  /** The window; `<= 0` never arms (the knob's "off"). */
  readonly ms: number;
  readonly onFire: () => void;
}): TurnWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    arm(): void {
      if (options.ms <= 0 || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        options.onFire();
      }, options.ms);
    },
    disarm(): void {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}

// The turn-taking gate (voice-relay-design.md §4; the dropped spec's gotcha #5).
// The mic must stay closed while the assistant is thinking/speaking, then reopen
// once the turn is done AND all queued audio has played. The gate is STICKY: an
// open() that lands before the mic loop reaches waitUntilOpen() is never lost
// (no missed-signal deadlock), because "open" is a persistent boolean, not a
// one-shot event. Reusable across turns — close at turn start, open at turn end.

export class TurnTakingGate {
  #isOpen: boolean
  #waiters: Array<() => void> = []

  constructor(initiallyOpen = true) {
    this.#isOpen = initiallyOpen
  }

  get isOpen(): boolean {
    return this.#isOpen
  }

  // Close the gate — the mic loop blocks at its next waitUntilOpen().
  close(): void {
    this.#isOpen = false
  }

  // Open the gate and release every pending waiter.
  open(): void {
    this.#isOpen = true
    const waiters = this.#waiters
    this.#waiters = []
    for (const resolve of waiters) resolve()
  }

  // Resolve as soon as the gate is open — immediately if it already is (the
  // sticky property: an earlier open() is reflected in #isOpen, so it is never
  // missed even if it preceded this call).
  async waitUntilOpen(): Promise<void> {
    if (this.#isOpen) return
    await new Promise<void>((resolve) => {
      this.#waiters.push(resolve)
    })
  }
}

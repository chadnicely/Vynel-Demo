// `SyntheticEventQueue` — the internal queue bridging the synchronous-looking
// `canUseTool` callback (which awaits a Promise) to the `async function*`
// session generator (which yields). Used by `run-claude-chat-session.ts` to
// interleave callback-emitted approval events with the SDK's own event
// stream. See `docs/blueprints/providers/blueprint.md §11.2`.

export class SyntheticEventQueue<T> {
  private readonly events: T[] = []
  private resolveNext: ((value: T) => void) | null = null
  private isClosed = false

  enqueue(event: T): void {
    if (this.isClosed) return
    if (this.resolveNext) {
      const resolve = this.resolveNext
      this.resolveNext = null
      resolve(event)
    } else {
      this.events.push(event)
    }
  }

  /**
   * Returns a Promise that resolves with the next event. If the queue is
   * empty, the Promise waits until `enqueue` is called.
   */
  dequeue(): Promise<T> {
    const buffered = this.events.shift()
    if (buffered !== undefined) {
      return Promise.resolve(buffered)
    }
    return new Promise<T>((resolve) => {
      this.resolveNext = resolve
    })
  }

  isEmpty(): boolean {
    return this.events.length === 0
  }

  /**
   * Stops accepting new events; subsequent `enqueue` calls are no-ops. The
   * generator's `finally` block calls this — it is the unwinder, not the queue.
   */
  close(): void {
    this.isClosed = true
  }
}

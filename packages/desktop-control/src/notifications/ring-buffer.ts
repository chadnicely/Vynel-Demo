// A bounded in-memory ring buffer. Once `capacity` is exceeded the oldest
// entry drops. `listSince` powers the "events since T" query the notifications
// reader exposes. Generic so the accessibility surface can reuse it later.

export class RingBuffer<TItem> {
  private readonly items: TItem[] = []

  constructor(
    private readonly capacity: number,
    private readonly timestampOf: (item: TItem) => string,
  ) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('RingBuffer capacity must be a positive integer.')
    }
  }

  push(item: TItem): void {
    this.items.push(item)
    if (this.items.length > this.capacity) {
      this.items.shift()
    }
  }

  /**
   * Items whose timestamp is strictly after `sinceIso`, oldest-first. All
   * buffered items when omitted. Comparison is by parsed time (not lexical) so
   * differing ISO precisions/offsets compare correctly; an unparseable
   * `sinceIso` is treated as "no filter" (returns all) rather than silently
   * dropping everything.
   */
  listSince(sinceIso?: string): TItem[] {
    if (sinceIso === undefined) {
      return [...this.items]
    }
    const sinceMs = Date.parse(sinceIso)
    if (Number.isNaN(sinceMs)) {
      return [...this.items]
    }
    return this.items.filter((item) => Date.parse(this.timestampOf(item)) > sinceMs)
  }

  get size(): number {
    return this.items.length
  }

  clear(): void {
    this.items.length = 0
  }
}

// `ActiveSessionRegistry` — the in-memory map of in-flight sessions so they
// can be interrupted from outside the SDK callback. Each concrete provider
// holds one as a private field. See `docs/blueprints/providers/blueprint.md §9`.

export type ActiveSessionRecord = {
  sessionId: string
  startedAt: Date
  /** Cancels the underlying runtime session when called. */
  cancel: () => Promise<void>
}

export class ActiveSessionRegistry {
  private readonly sessionsBySessionId = new Map<string, ActiveSessionRecord>()

  register(record: ActiveSessionRecord): void {
    this.sessionsBySessionId.set(record.sessionId, record)
  }

  unregister(sessionId: string): void {
    this.sessionsBySessionId.delete(sessionId)
  }

  isActive(sessionId: string): boolean {
    return this.sessionsBySessionId.has(sessionId)
  }

  async interrupt(sessionId: string): Promise<boolean> {
    const record = this.sessionsBySessionId.get(sessionId)
    if (!record) {
      return false
    }
    await record.cancel()
    this.sessionsBySessionId.delete(sessionId)
    return true
  }

  listActiveSessionIds(): string[] {
    return Array.from(this.sessionsBySessionId.keys())
  }
}
